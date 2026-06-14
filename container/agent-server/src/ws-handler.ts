import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { Event } from "@opencode-ai/sdk";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import { autoCommit, autoPush, getHistory, revertToCommit } from "./git-ops.js";
import { createNewSite, importExistingRepo, resetWorkspace } from "./site-init.js";
import { createLogger } from "./logger.js";
import { detectCommand, HELP_TEXT, sanitizeError, truncateForCommit } from "./utils.js";
import type { Command } from "./utils.js";
import { handleChatMessage, runInactivityTimeout } from "./chat-handler.js";
import { createInactivityTimer, type InactivityTimer } from "./timeout.js";
import {
  parseWsMessage,
  REPO_IDENT_REGEX,
  INVALID_NAME_MESSAGE,
  type WsInboundMessage,
} from "./ws-schema.js";
import { executeUndo, executeDeploy } from "./ws-actions.js";
import { verifyServers } from "./verify.js";
import {
  commitSiteBrief,
  isSiteBriefEmpty,
  readSiteBrief,
  writeSiteBrief,
} from "./site-brief.js";
import { addClient, removeClient } from "./ws-clients.js";
import { isRestarting } from "./opencode-supervisor.js";
import { partToLogEntry } from "./opencode-message-log.js";
import type { QuestionItem } from "./ws-outbound.js";

const RESTARTING_MESSAGE =
  "設定を反映しています。少し待ってからもう一度お試しください。";

const log = createLogger("agent-server");
// opencode (AI) の応答本文 / tool 実行を永続化する専用ログ
// (/app/logs/opencode-messages.log)。Machine 再起動後も flyctl logs から追える。
const messageLog = createLogger("opencode-messages");

export type WsHandlerDeps = {
  opencode: ReturnType<typeof createOpencodeClient>;
  // opencode HTTP API のベース URL。question reply など SDK 1.2.27 に無い
  // エンドポイントを raw fetch で叩くために使う (server は 1.17.4)。
  opencodeUrl: string;
  inactivityTimeoutMs: number;
  workspaceDir: string;
  siteDomain: string;
};

function getOwner(): string {
  return process.env.GITHUB_OWNER ?? "hummer98";
}

export function registerWsHandler(
  app: Hono,
  upgradeWebSocket: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"],
  deps: WsHandlerDeps
): void {
  app.get(
    "/ws",
    upgradeWebSocket(() => {
      let sessionId: string | undefined;
      let eventIterator: AsyncGenerator | undefined;
      let inactivityTimer: InactivityTimer | undefined;
      // session.idle 時の commit メッセージに使うため、直近のユーザー入力を保持
      let lastUserMessage: string | undefined;
      // opencode-messages.log への二重記録防止 (同じ part.id が複数回 updated される)
      const loggedParts = new Set<string>();

      const persistMessagePart = (
        part: Parameters<typeof partToLogEntry>[0]
      ): void => {
        const entry = partToLogEntry(part, sessionId as string);
        if (!entry) return;
        if (loggedParts.has(entry.partId)) return;
        loggedParts.add(entry.partId);
        // kind を msg に、残りを構造化フィールドとして JSON Lines に流す
        const { kind, ...rest } = entry;
        messageLog.info(kind, rest);
      };

      const handleEvent = (
        event: Event,
        ws: { send: (data: string) => void }
      ) => {
        // opencode の question ツール (ユーザーへの選択肢提示)。
        // SDK 1.2.27 の Event union には無い (server は 1.17.4) ため文字列で拾う。
        // 回答が返るまで agent はブロックするので、editor に選択肢を転送して
        // /question/{id}/reply で回答するまで run は idle にならない。
        if ((event.type as string) === "question.asked") {
          const props = (event as { properties: unknown }).properties as {
            id: string;
            sessionID: string;
            questions: QuestionItem[];
          };
          if (props.sessionID !== sessionId) return;
          // 回答待ちの間はユーザーの思考時間を奪わないよう inactivity timeout を止める。
          inactivityTimer?.stop();
          ws.send(
            JSON.stringify({
              type: "question",
              requestId: props.id,
              questions: props.questions,
            })
          );
          return;
        }

        switch (event.type) {
          case "message.part.delta": {
            const props = event.properties as {
              sessionID: string;
              delta: string;
              field: string;
            };
            if (props.sessionID !== sessionId) return;
            if (props.field === "text" && props.delta) {
              ws.send(JSON.stringify({ type: "stream", delta: props.delta }));
            }
            break;
          }

          case "message.part.updated": {
            const { part } = event.properties;
            if (part.sessionID !== sessionId) return;

            // assistant テキスト本文 / tool 実行結果をサーバー側ログに永続化
            persistMessagePart(part);

            if (part.type === "tool") {
              // question ツールの running は question.asked イベントで UI を出すので
              // ここでの status 表示 (「考え中」化) は抑制する。
              if (part.state?.status === "running" && part.tool !== "question") {
                ws.send(JSON.stringify({ type: "status", message: part.tool }));
              } else if (part.state?.status === "completed") {
                ws.send(JSON.stringify({ type: "file-changed" }));
              }
            }
            break;
          }

          case "session.status": {
            if (event.properties.sessionID !== sessionId) return;
            if (event.properties.status?.type === "idle") {
              inactivityTimer?.stop();
              ws.send(JSON.stringify({ type: "stream-end" }));
              log.info("OpenCode response completed (stream)", { sessionId });
              // run 完了。次 run は別 part.id になるので dedup set を解放しメモリを抑える。
              loggedParts.clear();

              const messageForCommit = lastUserMessage;
              lastUserMessage = undefined;

              (async () => {
                try {
                  // commit gate: Vite/Hono が応答しなければ commit を保留する。
                  // 自己修復ループが失敗した状態 (白画面・ビルドエラー等) のまま
                  // 履歴に残るのを防ぐ目的。
                  const verify = await verifyServers();
                  if (!verify.ok) {
                    log.warn("Skipping commit: dev servers unhealthy", {
                      reasons: verify.reasons,
                    });
                    ws.send(
                      JSON.stringify({
                        type: "warning",
                        message:
                          "編集後にプレビューが応答していません。表示が崩れている可能性があります。元に戻すか、もう一度指示してください。",
                        reasons: verify.reasons,
                      })
                    );
                    return;
                  }

                  const commitMessage = messageForCommit
                    ? truncateForCommit(messageForCommit)
                    : "AI edit";
                  const hash = autoCommit(commitMessage);
                  if (hash) {
                    await autoPush();
                    ws.send(
                      JSON.stringify({
                        type: "git",
                        action: "commit",
                        hash,
                        message: commitMessage,
                      })
                    );
                  }
                } catch (err) {
                  log.error("Background git ops failed", { error: sanitizeError(err) });
                }
              })();
            }
            break;
          }

          case "session.error": {
            if (event.properties.sessionID !== sessionId) return;
            inactivityTimer?.stop();
            const error = event.properties.error;
            const errorMsg =
              error && "data" in error
                ? (error as { data: { message: string } }).data.message
                : "Unknown error";
            ws.send(
              JSON.stringify({
                type: "error",
                message: `AI error: ${errorMsg}`,
              })
            );
            break;
          }
        }
      };

      const handleCommand = async (
        cmd: Command,
        ws: { send: (data: string) => void }
      ): Promise<void> => {
        switch (cmd.type) {
          case "undo": {
            ws.send(JSON.stringify({ type: "status", message: "undoing" }));
            await executeUndo(ws);
            break;
          }

          case "deploy": {
            await executeDeploy(ws, deps.siteDomain);
            break;
          }

          case "create": {
            // detectCommand 経由は自然言語マッチで siteName が日本語のことがある。
            // 英数字+ハイフン以外は GitHub 側で 422 になるため事前に弾く (ペルソナ向け文言)。
            if (!REPO_IDENT_REGEX.test(cmd.siteName)) {
              ws.send(
                JSON.stringify({ type: "error", message: INVALID_NAME_MESSAGE })
              );
              return;
            }
            ws.send(JSON.stringify({ type: "status", message: "creating" }));
            try {
              const result = await createNewSite(getOwner(), cmd.siteName);
              if (result.success) {
                ws.send(
                  JSON.stringify({
                    type: "site-init",
                    action: "created",
                    repoUrl: result.repoUrl,
                  })
                );
              } else {
                ws.send(
                  JSON.stringify({ type: "error", message: result.error })
                );
              }
            } catch (err) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `サイト作成に失敗しました: ${err}`,
                })
              );
            }
            break;
          }

          case "help": {
            ws.send(
              JSON.stringify({
                type: "response",
                message: HELP_TEXT,
              })
            );
            break;
          }

          case "import": {
            if (!REPO_IDENT_REGEX.test(cmd.repoName)) {
              ws.send(
                JSON.stringify({ type: "error", message: INVALID_NAME_MESSAGE })
              );
              return;
            }
            ws.send(JSON.stringify({ type: "status", message: "importing" }));
            try {
              const result = await importExistingRepo(getOwner(), cmd.repoName);
              if (result.success) {
                ws.send(
                  JSON.stringify({
                    type: "site-init",
                    action: "imported",
                    repoUrl: result.repoUrl,
                  })
                );
              } else {
                ws.send(
                  JSON.stringify({ type: "error", message: result.error })
                );
              }
            } catch (err) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `リポジトリ取り込みに失敗しました: ${err}`,
                })
              );
            }
            break;
          }

          case "reset": {
            ws.send(JSON.stringify({ type: "status", message: "resetting" }));
            const result = await resetWorkspace();
            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: "response",
                  message: "ワークスペースを初期状態にリセットしました",
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `リセットに失敗しました: ${result.error}`,
                })
              );
            }
            break;
          }
        }
      };

      const handleMessage = async (
        msg: WsInboundMessage,
        ws: { send: (data: string) => void }
      ): Promise<void> => {
        // 再起動中は重い処理を弾く（友人ペルソナ向け文言で即応答）
        if (
          isRestarting() &&
          (msg.type === "chat" ||
            msg.type === "undo" ||
            msg.type === "deploy" ||
            msg.type === "revert")
        ) {
          ws.send(
            JSON.stringify({ type: "error", message: RESTARTING_MESSAGE })
          );
          return;
        }
        switch (msg.type) {
          case "chat": {
            lastUserMessage = msg.message;
            if (!msg.elementContext?.ocId) {
              const cmd = detectCommand(msg.message);
              if (cmd) {
                log.info("Command detected", { command: cmd.type });
                await handleCommand(cmd, ws);
                return;
              }
            }
            await handleChatMessage(msg, {
              opencode: deps.opencode,
              ws,
              workspaceDir: deps.workspaceDir,
              getSessionId: () => sessionId,
              setSessionId: (id) => {
                sessionId = id;
              },
              timer: inactivityTimer,
            });
            return;
          }

          case "undo": {
            await executeUndo(ws);
            return;
          }

          case "history": {
            try {
              const commits = getHistory(msg.count ?? 20);
              ws.send(JSON.stringify({ type: "history", commits }));
              log.info("History sent", { count: commits.length });
            } catch (err) {
              log.error("History failed", { error: sanitizeError(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `履歴の取得に失敗しました: ${err}`,
                })
              );
            }
            return;
          }

          case "revert": {
            try {
              ws.send(JSON.stringify({ type: "status", message: "reverting" }));
              const newHash = revertToCommit(msg.hash);
              if (newHash) {
                ws.send(
                  JSON.stringify({
                    type: "git",
                    action: "revert",
                    message: `${msg.hash} の状態に戻しました (${newHash})`,
                  })
                );
                log.info("Revert to commit completed", {
                  target: msg.hash,
                  newHash,
                });
                autoPush().catch((err) =>
                  log.error("Push after revert failed", { error: sanitizeError(err) })
                );
              } else {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "指定の状態に戻せませんでした",
                  })
                );
              }
            } catch (err) {
              log.error("Revert failed", { error: sanitizeError(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `戻す操作に失敗しました: ${err}`,
                })
              );
            }
            return;
          }

          case "deploy": {
            await executeDeploy(ws, deps.siteDomain);
            return;
          }

          case "create-site": {
            // owner はクライアント値を信用せず、サーバー側の env で固定
            const owner = getOwner();
            log.info("Create site requested", {
              owner,
              siteName: msg.siteName,
            });
            if (msg.owner && msg.owner !== owner) {
              log.warn("Ignoring client-supplied owner", {
                clientOwner: msg.owner,
              });
            }
            ws.send(JSON.stringify({ type: "status", message: "creating" }));
            try {
              const result = await createNewSite(owner, msg.siteName);
              if (result.success) {
                ws.send(
                  JSON.stringify({
                    type: "site-init",
                    action: "created",
                    repoUrl: result.repoUrl,
                  })
                );
              } else {
                ws.send(
                  JSON.stringify({ type: "error", message: result.error })
                );
              }
            } catch (err) {
              log.error("Create site failed", { error: sanitizeError(err) });
              ws.send(JSON.stringify({ type: "error", message: sanitizeError(err) }));
            }
            return;
          }

          case "site-brief-get": {
            try {
              const content = readSiteBrief(deps.workspaceDir);
              ws.send(
                JSON.stringify({
                  type: "site-brief",
                  content,
                  isEmpty: isSiteBriefEmpty(content),
                })
              );
            } catch (err) {
              log.error("site-brief-get failed", { error: sanitizeError(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "サイト情報の読み込みに失敗しました",
                })
              );
            }
            return;
          }

          case "site-brief-set": {
            try {
              writeSiteBrief(msg.content, deps.workspaceDir);
              const hash = commitSiteBrief("サイト情報を更新", deps.workspaceDir);
              if (hash) {
                autoPush().catch((err) =>
                  log.error("Push after site-brief-set failed", {
                    error: sanitizeError(err),
                  })
                );
              }
              ws.send(
                JSON.stringify({
                  type: "site-brief-saved",
                  hash: hash ?? undefined,
                })
              );
            } catch (err) {
              log.error("site-brief-set failed", { error: sanitizeError(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "サイト情報の保存に失敗しました",
                })
              );
            }
            return;
          }

          case "answer": {
            // opencode の question ツールへの回答。SDK 1.2.27 に該当メソッドが
            // 無いため raw fetch で /question/{id}/reply を叩く (server 1.17.4)。
            try {
              const res = await fetch(
                `${deps.opencodeUrl}/question/${encodeURIComponent(msg.requestId)}/reply`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ answers: msg.answers }),
                }
              );
              if (!res.ok) {
                throw new Error(`reply failed: HTTP ${res.status}`);
              }
              // 回答送信で agent が再開する。inactivity timeout を再開。
              inactivityTimer?.reset();
              log.info("Question reply sent", { requestId: msg.requestId });
            } catch (err) {
              log.error("Question reply failed", { error: sanitizeError(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "回答の送信に失敗しました。もう一度お試しください。",
                })
              );
            }
            return;
          }

          case "import-repo": {
            const owner = getOwner();
            log.info("Import repo requested", {
              owner,
              repoName: msg.repoName,
            });
            if (msg.owner && msg.owner !== owner) {
              log.warn("Ignoring client-supplied owner", {
                clientOwner: msg.owner,
              });
            }
            ws.send(JSON.stringify({ type: "status", message: "importing" }));
            try {
              const result = await importExistingRepo(owner, msg.repoName);
              if (result.success) {
                ws.send(
                  JSON.stringify({
                    type: "site-init",
                    action: "imported",
                    repoUrl: result.repoUrl,
                  })
                );
              } else {
                ws.send(
                  JSON.stringify({ type: "error", message: result.error })
                );
              }
            } catch (err) {
              log.error("Import repo failed", { error: sanitizeError(err) });
              ws.send(JSON.stringify({ type: "error", message: sanitizeError(err) }));
            }
            return;
          }
        }
      };

      return {
        async onOpen(_, ws) {
          log.info("WS connected");
          addClient(ws);

          inactivityTimer = createInactivityTimer(
            deps.inactivityTimeoutMs,
            () => {
              runInactivityTimeout({
                opencode: deps.opencode,
                ws,
                getSessionId: () => sessionId,
                setSessionId: (id) => {
                  sessionId = id;
                },
              });
            }
          );

          try {
            const { stream } = await deps.opencode.event.subscribe();
            eventIterator = stream;

            const iterator = stream[Symbol.asyncIterator]();
            const first = await iterator.next();
            if (!first.done) {
              const ev = first.value as Event;
              log.info("Event stream connected", { type: ev.type });
            }

            (async () => {
              try {
                while (true) {
                  const result = await iterator.next();
                  if (result.done) break;
                  const ev = result.value as Event;
                  if (ev.type === "server.heartbeat") continue;
                  inactivityTimer?.reset();
                  if (sessionId) {
                    handleEvent(ev, ws);
                  }
                }
                log.info("Event stream ended");
              } catch (err) {
                log.error("Event stream error", { error: sanitizeError(err) });
              }
            })();
          } catch (err) {
            log.error("OpenCode client subscribe failed", {
              error: sanitizeError(err),
            });
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to connect to OpenCode",
              })
            );
          }
        },

        async onMessage(event, ws) {
          let raw: unknown;
          try {
            raw = JSON.parse(event.data as string);
          } catch (err) {
            log.warn("WS message parse failed (invalid JSON)", {
              error: sanitizeError(err),
            });
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid message",
              })
            );
            return;
          }

          const parsed = parseWsMessage(raw);
          if (!parsed.ok) {
            log.warn("WS message schema rejected", { error: parsed.error });
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid message",
              })
            );
            return;
          }

          log.info("WS message received", { type: parsed.data.type });
          await handleMessage(parsed.data, ws);
        },

        onClose(_, ws) {
          log.info("WS disconnected", { sessionId });
          removeClient(ws);
          inactivityTimer?.stop();
          inactivityTimer = undefined;
          if (eventIterator) {
            eventIterator.return(undefined).catch(() => {});
            eventIterator = undefined;
          }
        },

        onError(error) {
          log.error("WS error", { error: sanitizeError(error) });
        },
      };
    })
  );
}

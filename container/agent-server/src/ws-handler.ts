import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { Event } from "@opencode-ai/sdk";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import { autoCommit, autoPush, getHistory, revertToCommit } from "./git-ops.js";
import { createNewSite, importExistingRepo, resetWorkspace } from "./site-init.js";
import { createLogger } from "./logger.js";
import { detectCommand, HELP_TEXT, sanitizeError } from "./utils.js";
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

const log = createLogger("agent-server");

export type WsHandlerDeps = {
  opencode: ReturnType<typeof createOpencodeClient>;
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

      const handleEvent = (
        event: Event,
        ws: { send: (data: string) => void }
      ) => {
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

            if (part.type === "tool") {
              if (part.state?.status === "running") {
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

              (async () => {
                try {
                  const hash = autoCommit("AI edit");
                  if (hash) {
                    await autoPush();
                    ws.send(
                      JSON.stringify({ type: "git", action: "commit", hash })
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
        switch (msg.type) {
          case "chat": {
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

        onClose() {
          log.info("WS disconnected", { sessionId });
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

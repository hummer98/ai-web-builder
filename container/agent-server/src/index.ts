import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { Event } from "@opencode-ai/sdk";
import { autoCommit, autoPush, getHistory, revertToCommit, undoLastCommit } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createNewSite, importExistingRepo } from "./site-init.js";
import { createLogger } from "./logger.js";
import { buildPrompt, detectCommand } from "./utils.js";
import { setupHmrProxy } from "./hmr-proxy.js";
import { createApp } from "./app.js";
import { parseWsMessage } from "./ws-schema.js";
import { handleCommand, notifyPushResult } from "./ws-handlers.js";

const log = createLogger("agent-server");
const app = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const SITE_NAME = process.env.SITE_DOMAIN ?? "guest-site";
const DEFAULT_OWNER = "hummer98";

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let opencode: ReturnType<typeof createOpencodeClient>;
    let sessionId: string | undefined;
    let eventIterator: AsyncGenerator | undefined;

    return {
      async onOpen(_, ws) {
        log.info("WS connected");

        try {
          opencode = createOpencodeClient({ baseUrl: OPENCODE_URL });
          log.info("OpenCode client created", { url: OPENCODE_URL });

          // イベント購読を開始（promptAsync より先に確立する必要がある）
          const { stream } = await opencode.event.subscribe();
          eventIterator = stream;

          // server.connected を待つ
          const iterator = stream[Symbol.asyncIterator]();
          const first = await iterator.next();
          if (!first.done) {
            const ev = first.value as Event;
            log.info("Event stream connected", { type: ev.type });
          }

          // バックグラウンドでイベントを処理し続ける
          (async () => {
            try {
              while (true) {
                const result = await iterator.next();
                if (result.done) break;
                const ev = result.value as Event;
                if (ev.type === "server.heartbeat") continue;
                if (sessionId) {
                  handleEvent(ev, sessionId, ws);
                }
              }
              log.info("Event stream ended");
            } catch (err) {
              log.error("Event stream error", { error: String(err) });
            }
          })();
        } catch (err) {
          log.error("OpenCode client creation failed", {
            error: String(err),
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
        const parsed = parseWsMessage(event.data as string);
        if (!parsed.ok) {
          log.warn("Invalid WS message rejected", {
            reason: parsed.reason,
            detail: parsed.detail.slice(0, 200),
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                parsed.reason === "invalid-json"
                  ? "メッセージの形式が正しくありません"
                  : "送信された内容を処理できませんでした",
            })
          );
          return;
        }
        const data = parsed.value;
        log.info("WS message received", { type: data.type });

        if (data.type === "chat") {
          try {
            // コマンド判定（要素コンテキストがない場合のみ）
            if (!data.elementContext?.ocId) {
              const cmd = detectCommand(data.message);
              if (cmd) {
                log.info("Command detected", { command: cmd.type });
                await handleCommand(cmd, ws, { siteName: SITE_NAME, defaultOwner: DEFAULT_OWNER });
                return;
              }
            }

            // セッション作成（初回のみ）
            if (!sessionId) {
              const res = await opencode.session.create();
              log.info("OpenCode session.create response", { res: JSON.stringify(res).slice(0, 500) });
              // SDK v1 と v2 でレスポンス形式が異なる
              const session = res.data ?? res;
              sessionId = session.id;
              log.info("OpenCode session created", { sessionId });
            }

            const currentSessionId = sessionId;

            // ユーザーの指示を通知
            ws.send(
              JSON.stringify({
                type: "status",
                message: "thinking",
              })
            );

            // 非同期プロンプト送信（イベントストリーム経由でレスポンスを受信）
            const prompt = buildPrompt(data);
            await opencode.session.promptAsync({
              path: { id: currentSessionId },
              body: {
                parts: [{ type: "text", text: prompt }],
              },
            });
            log.info("promptAsync sent", { sessionId: currentSessionId });
          } catch (err) {
            log.error("OpenCode promptAsync failed", { error: String(err) });
            ws.send(
              JSON.stringify({
                type: "error",
                message: `AI error: ${err}`,
              })
            );
          }
        }

        if (data.type === "undo") {
          try {
            const hash = undoLastCommit();
            if (hash) {
              ws.send(
                JSON.stringify({
                  type: "git",
                  action: "undo",
                  message: `変更を元に戻しました (${hash})`,
                })
              );
              log.info("Undo completed", { hash });
              // undo 後も push（バックグラウンド）。失敗時は WS で通知する
              autoPush().then((result) => notifyPushResult(result, "undo", ws));
            } else {
              ws.send(
                JSON.stringify({ type: "error", message: "元に戻す変更がありません" })
              );
            }
          } catch (err) {
            log.error("Undo failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: `元に戻す操作に失敗しました: ${err}` })
            );
          }
        }

        if (data.type === "history") {
          try {
            const commits = getHistory(data.count ?? 20);
            ws.send(
              JSON.stringify({ type: "history", commits })
            );
            log.info("History sent", { count: commits.length });
          } catch (err) {
            log.error("History failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: `履歴の取得に失敗しました: ${err}` })
            );
          }
        }

        if (data.type === "revert") {
          try {
            ws.send(JSON.stringify({ type: "status", message: "reverting" }));
            const newHash = revertToCommit(data.hash);
            if (newHash) {
              ws.send(
                JSON.stringify({
                  type: "git",
                  action: "revert",
                  message: `${data.hash} の状態に戻しました (${newHash})`,
                })
              );
              log.info("Revert to commit completed", { target: data.hash, newHash });
              // revert 後も push（バックグラウンド）。失敗時は WS で通知する
              autoPush().then((result) => notifyPushResult(result, "revert", ws));
            } else {
              ws.send(
                JSON.stringify({ type: "error", message: "指定の状態に戻せませんでした" })
              );
            }
          } catch (err) {
            log.error("Revert failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: `戻す操作に失敗しました: ${err}` })
            );
          }
        }

        if (data.type === "deploy") {
          const siteName = process.env.SITE_DOMAIN ?? "guest-site";
          log.info("Deploy requested", { siteName });
          ws.send(JSON.stringify({ type: "status", message: "deploying" }));

          try {
            const result = await deploy(siteName);
            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: "deploy",
                  success: true,
                  url: result.pagesUrl,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "deploy",
                  success: false,
                  error: result.error,
                })
              );
            }
          } catch (err) {
            log.error("Deploy failed", { error: String(err) });
            ws.send(
              JSON.stringify({
                type: "deploy",
                success: false,
                error: String(err),
              })
            );
          }
        }

        if (data.type === "create-site") {
          const { owner, siteName } = data;
          log.info("Create site requested", { owner, siteName });
          ws.send(JSON.stringify({ type: "status", message: "creating" }));

          try {
            const result = await createNewSite(owner, siteName);
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
            log.error("Create site failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: String(err) })
            );
          }
        }

        if (data.type === "import-repo") {
          const { owner, repoName } = data;
          log.info("Import repo requested", { owner, repoName });
          ws.send(JSON.stringify({ type: "status", message: "importing" }));

          try {
            const result = await importExistingRepo(owner, repoName);
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
            log.error("Import repo failed", { error: String(err) });
            ws.send(
              JSON.stringify({ type: "error", message: String(err) })
            );
          }
        }
      },

      onClose() {
        log.info("WS disconnected", { sessionId });
        // イベントストリームを終了
        if (eventIterator) {
          eventIterator.return(undefined).catch(() => {});
          eventIterator = undefined;
        }
      },

      onError(error) {
        log.error("WS error", { error: String(error) });
      },
    };
  })
);

// ---------------------------------------------------------------------------
// OpenCode SSE ストリーミング
// ---------------------------------------------------------------------------

/**
 * OpenCode イベントを WS メッセージに変換して送信
 */
function handleEvent(
  event: Event,
  sessionId: string,
  ws: { send: (data: string) => void }
) {
  switch (event.type) {
    case "message.part.delta": {
      // テキストの差分をストリーミング送信
      const props = event.properties as { sessionID: string; delta: string; field: string };
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
          // ツール完了 → ファイル変更の可能性 → プレビュー更新トリガー
          ws.send(JSON.stringify({ type: "file-changed" }));
        }
      }
      break;
    }

    case "session.status": {
      if (event.properties.sessionID !== sessionId) return;
      if (event.properties.status?.type === "idle") {
        ws.send(JSON.stringify({ type: "stream-end" }));
        log.info("OpenCode response completed (stream)", { sessionId });

        // 自動コミット + push
        (async () => {
          try {
            const hash = autoCommit("AI edit");
            if (hash) {
              ws.send(JSON.stringify({ type: "git", action: "commit", hash }));
              const result = await autoPush();
              notifyPushResult(result, "edit", ws);
            }
          } catch (err) {
            log.error("Background git ops failed", { error: String(err) });
          }
        })();
      }
      break;
    }

    case "session.error": {
      if (event.properties.sessionID !== sessionId) return;
      const error = event.properties.error;
      const errorMsg = error && "data" in error ? (error as { data: { message: string } }).data.message : "Unknown error";
      ws.send(JSON.stringify({ type: "error", message: `AI error: ${errorMsg}` }));
      break;
    }
  }
}

const port = 8080;
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  log.info(`Agent Server started on 0.0.0.0:${port}`);
});

// Vite HMR WebSocket proxy（injectWebSocket の前に登録）
setupHmrProxy(server);

injectWebSocket(server);

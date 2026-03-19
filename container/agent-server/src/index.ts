import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { Event } from "@opencode-ai/sdk";
import { autoCommit, autoPush, undoLastCommit, getHistory, revertToCommit } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createNewSite, importExistingRepo } from "./site-init.js";
import { createLogger } from "./logger.js";
import { truncateForCommit, buildPrompt, detectCommand, HELP_TEXT } from "./utils.js";
import type { Command } from "./utils.js";
import { createApp } from "./app.js";

const log = createLogger("agent-server");
const app = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const SITE_NAME = process.env.SITE_DOMAIN ?? "guest-site";

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let opencode: ReturnType<typeof createOpencodeClient>;
    let sessionId: string | undefined;
    let eventStream: AsyncGenerator | null = null;

    return {
      async onOpen(_, ws) {
        log.info("WS connected");

        try {
          opencode = createOpencodeClient({ baseUrl: OPENCODE_URL });
          log.info("OpenCode client created", { url: OPENCODE_URL });
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
        const data = JSON.parse(event.data as string);
        log.info("WS message received", { type: data.type });

        if (data.type === "chat") {
          try {
            // コマンド判定（要素コンテキストがない場合のみ）
            if (!data.elementContext?.ocId) {
              const cmd = detectCommand(data.message);
              if (cmd) {
                log.info("Command detected", { command: cmd.type });
                await handleCommand(cmd, ws);
                return;
              }
            }

            // セッション作成（初回のみ）
            if (!sessionId) {
              const res = await opencode.session.create();
              sessionId = res.data!.id;
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

            // イベントストリームを購読（初回のみ）
            if (!eventStream) {
              const sub = await opencode.event.subscribe();
              eventStream = sub.stream;
              processEventStream(eventStream, currentSessionId, ws);
            }

            // 非同期プロンプト送信（即座に返る、結果はイベントストリーム経由）
            const prompt = buildPrompt(data);
            await opencode.session.promptAsync({
              path: { id: currentSessionId },
              body: {
                parts: [{ type: "text", text: prompt }],
              },
            });

            log.info("OpenCode prompt sent (async)", { sessionId });
          } catch (err) {
            log.error("OpenCode prompt failed", { error: String(err) });
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
              // undo 後も push（バックグラウンド）
              autoPush().catch((err) =>
                log.error("Push after undo failed", { error: String(err) })
              );
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
              // revert 後も push（バックグラウンド）
              autoPush().catch((err) =>
                log.error("Push after revert failed", { error: String(err) })
              );
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
        if (eventStream) {
          eventStream.return(undefined);
          eventStream = null;
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
 * SSE イベントストリームを処理し、WS 経由でクライアントに転送
 */
async function processEventStream(
  stream: AsyncGenerator,
  sessionId: string,
  ws: { send: (data: string) => void }
) {
  try {
    for await (const event of stream) {
      handleEvent(event as Event, sessionId, ws);
    }
  } catch (err) {
    log.error("Event stream error", { error: String(err) });
  }
}

/**
 * OpenCode イベントを WS メッセージに変換して送信
 */
function handleEvent(
  event: Event,
  sessionId: string,
  ws: { send: (data: string) => void }
) {
  switch (event.type) {
    case "message.part.updated": {
      const { part, delta } = event.properties;
      if (part.sessionID !== sessionId) return;

      if (part.type === "text" && delta) {
        ws.send(JSON.stringify({ type: "stream", delta }));
      } else if (part.type === "tool") {
        if (part.state.status === "running") {
          ws.send(JSON.stringify({ type: "status", message: part.tool }));
        }
      }
      break;
    }

    case "session.status": {
      if (event.properties.sessionID !== sessionId) return;
      if (event.properties.status.type === "idle") {
        ws.send(JSON.stringify({ type: "stream-end" }));
        log.info("OpenCode response completed (stream)", { sessionId });

        // 自動コミット + push
        (async () => {
          try {
            const hash = autoCommit("AI edit");
            if (hash) {
              await autoPush();
              ws.send(JSON.stringify({ type: "git", action: "commit", hash }));
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

/**
 * 検出されたコマンドを実行し、結果を WebSocket で送信する。
 */
async function handleCommand(
  cmd: Command,
  ws: { send: (data: string) => void }
): Promise<void> {
  switch (cmd.type) {
    case "undo": {
      ws.send(JSON.stringify({ type: "status", message: "undoing" }));
      const hash = undoLastCommit();
      if (hash) {
        autoPush().catch(() => {});
        ws.send(
          JSON.stringify({
            type: "response",
            message: `変更を元に戻しました (commit: ${hash})`,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "元に戻せる変更がありませんでした",
          })
        );
      }
      break;
    }

    case "deploy": {
      ws.send(JSON.stringify({ type: "status", message: "deploying" }));
      const result = await deploy(SITE_NAME);
      if (result.success) {
        ws.send(
          JSON.stringify({
            type: "response",
            message: result.pagesUrl
              ? `サイトを公開しました！\n${result.pagesUrl}`
              : "サイトを公開しました！",
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `公開に失敗しました: ${result.error}`,
          })
        );
      }
      break;
    }

    case "create": {
      ws.send(JSON.stringify({ type: "status", message: "creating" }));
      try {
        const result = await createNewSite("hummer98", cmd.siteName);
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
          JSON.stringify({ type: "error", message: `サイト作成に失敗しました: ${err}` })
        );
      }
      break;
    }

    case "help": {
      ws.send(JSON.stringify({
        type: "response",
        message: HELP_TEXT,
      }));
      break;
    }

    case "import": {
      ws.send(JSON.stringify({ type: "status", message: "importing" }));
      try {
        const result = await importExistingRepo("hummer98", cmd.repoName);
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
          JSON.stringify({ type: "error", message: `リポジトリ取り込みに失敗しました: ${err}` })
        );
      }
      break;
    }
  }
}

const port = 8080;
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  log.info(`Agent Server started on 0.0.0.0:${port}`);
});

injectWebSocket(server);

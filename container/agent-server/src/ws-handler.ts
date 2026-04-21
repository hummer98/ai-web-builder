import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { Event } from "@opencode-ai/sdk";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import { autoCommit, autoPush, undoLastCommit, getHistory, revertToCommit } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createNewSite, importExistingRepo, resetWorkspace } from "./site-init.js";
import { createLogger } from "./logger.js";
import { detectCommand, HELP_TEXT } from "./utils.js";
import type { Command } from "./utils.js";
import { handleChatMessage, runInactivityTimeout } from "./chat-handler.js";
import { createInactivityTimer, type InactivityTimer } from "./timeout.js";

const log = createLogger("agent-server");

export type WsHandlerDeps = {
  opencode: ReturnType<typeof createOpencodeClient>;
  inactivityTimeoutMs: number;
  workspaceDir: string;
  siteDomain: string;
};

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
                  log.error("Background git ops failed", { error: String(err) });
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
            const result = await deploy(deps.siteDomain);
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
            ws.send(JSON.stringify({ type: "status", message: "importing" }));
            try {
              const result = await importExistingRepo(
                "hummer98",
                cmd.repoName
              );
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
                log.error("Event stream error", { error: String(err) });
              }
            })();
          } catch (err) {
            log.error("OpenCode client subscribe failed", {
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
            if (!data.elementContext?.ocId) {
              const cmd = detectCommand(data.message);
              if (cmd) {
                log.info("Command detected", { command: cmd.type });
                await handleCommand(cmd, ws);
                return;
              }
            }

            await handleChatMessage(data, {
              opencode: deps.opencode,
              ws,
              workspaceDir: deps.workspaceDir,
              getSessionId: () => sessionId,
              setSessionId: (id) => {
                sessionId = id;
              },
              timer: inactivityTimer,
            });
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
                autoPush().catch((err) =>
                  log.error("Push after undo failed", { error: String(err) })
                );
              } else {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "元に戻す変更がありません",
                  })
                );
              }
            } catch (err) {
              log.error("Undo failed", { error: String(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `元に戻す操作に失敗しました: ${err}`,
                })
              );
            }
          }

          if (data.type === "history") {
            try {
              const commits = getHistory(data.count ?? 20);
              ws.send(JSON.stringify({ type: "history", commits }));
              log.info("History sent", { count: commits.length });
            } catch (err) {
              log.error("History failed", { error: String(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `履歴の取得に失敗しました: ${err}`,
                })
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
                log.info("Revert to commit completed", {
                  target: data.hash,
                  newHash,
                });
                autoPush().catch((err) =>
                  log.error("Push after revert failed", { error: String(err) })
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
              log.error("Revert failed", { error: String(err) });
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `戻す操作に失敗しました: ${err}`,
                })
              );
            }
          }

          if (data.type === "deploy") {
            log.info("Deploy requested", { siteName: deps.siteDomain });
            ws.send(JSON.stringify({ type: "status", message: "deploying" }));

            try {
              const result = await deploy(deps.siteDomain);
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
              ws.send(JSON.stringify({ type: "error", message: String(err) }));
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
              ws.send(JSON.stringify({ type: "error", message: String(err) }));
            }
          }
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
          log.error("WS error", { error: String(error) });
        },
      };
    })
  );
}

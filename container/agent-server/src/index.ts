import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import { setupHmrProxy } from "./hmr-proxy.js";
import { registerWsHandler } from "./ws-handler.js";
import { startOpencode, stopOpencode } from "./opencode-supervisor.js";

const log = createLogger("agent-server");

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const SITE_DOMAIN = process.env.SITE_DOMAIN ?? "guest-site";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";
const LOGS_DIR = process.env.LOGS_DIR ?? "/app/logs";
const INACTIVITY_TIMEOUT_MS =
  Number(process.env.INACTIVITY_TIMEOUT_MS) > 0
    ? Number(process.env.INACTIVITY_TIMEOUT_MS)
    : 180_000;

// (1) opencode を先に起動・ready 待ち。これにより、agent-server が listen を始めた瞬間に
//     入ってきた WS 接続でも opencode subscribe が成功する（race 解消）。
await startOpencode({
  cwd: WORKSPACE_DIR,
  port: 4096,
  hostname: "127.0.0.1",
  logsDir: LOGS_DIR,
  postprocessScript: resolve(import.meta.dirname, "../../opencode-postprocess.mjs"),
  commonMdPath: resolve(import.meta.dirname, "../../instructions/common.md"),
  siteBriefPath: resolve(WORKSPACE_DIR, "SITE_BRIEF.md"),
});

const app = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// NOTE: 挙動変更 — 従来は接続ごとに新 client を生成していたが、
// ここで 1 度だけ生成して全接続で共有する（SDK はほぼステートレスなので実害なし）
registerWsHandler(app, upgradeWebSocket, {
  opencode: createOpencodeClient({ baseUrl: OPENCODE_URL }),
  opencodeUrl: OPENCODE_URL,
  inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
  workspaceDir: WORKSPACE_DIR,
  siteDomain: SITE_DOMAIN,
});

const port = 8080;
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  log.info(`Agent Server started on 0.0.0.0:${port}`);
});

setupHmrProxy(server);
injectWebSocket(server);

// (3) graceful shutdown — opencode を止めてから Hono server.close() を呼び、
//     最後に 5s の forced exit safeguard を入れる。
const shutdown = async (sig: string) => {
  log.info("shutdown signal", { sig });
  try {
    await stopOpencode();
  } catch (err) {
    log.error("stopOpencode failed during shutdown", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
};
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

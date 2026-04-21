import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import { setupHmrProxy } from "./hmr-proxy.js";
import { registerWsHandler } from "./ws-handler.js";

const log = createLogger("agent-server");

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const SITE_DOMAIN = process.env.SITE_DOMAIN ?? "guest-site";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";
const INACTIVITY_TIMEOUT_MS =
  Number(process.env.INACTIVITY_TIMEOUT_MS) > 0
    ? Number(process.env.INACTIVITY_TIMEOUT_MS)
    : 180_000;

const app = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// NOTE: 挙動変更 — 従来は接続ごとに新 client を生成していたが、
// ここで 1 度だけ生成して全接続で共有する（SDK はほぼステートレスなので実害なし）
registerWsHandler(app, upgradeWebSocket, {
  opencode: createOpencodeClient({ baseUrl: OPENCODE_URL }),
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

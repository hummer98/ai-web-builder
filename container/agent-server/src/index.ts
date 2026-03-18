import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");
const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173";

// 本番環境では Cloudflare Access JWT が必須（/health は除外）
app.use("*", async (c, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  if (c.req.path === "/health") return next();
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    log.warn("Access denied: missing Cf-Access-Jwt-Assertion", {
      path: c.req.path,
      ip: c.req.header("x-forwarded-for") ?? "unknown",
    });
    return c.text("Unauthorized", 401);
  }
  return next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// ゲストサイトプレビューへのプロキシ (/preview/*)
// Vite の base='/preview/' に合わせてパスをそのまま転送する
app.all("/preview/*", async (c) => {
  const path = c.req.path; // /preview/... のまま渡す
  const url = `${VITE_URL}${path}`;
  try {
    const resp = await fetch(url, {
      method: c.req.method,
      headers: c.req.raw.headers,
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch {
    return c.text("Preview server not available", 502);
  }
});

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let opencode: ReturnType<typeof createOpencodeClient>;
    let sessionId: string | undefined;

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
            // セッション作成（初回のみ）
            if (!sessionId) {
              const session = await opencode.session.create();
              sessionId = session.id;
              log.info("OpenCode session created", { sessionId });
            }

            // ユーザーの指示を通知
            ws.send(
              JSON.stringify({
                type: "status",
                message: "thinking",
              })
            );

            // プロンプト送信
            const prompt = buildPrompt(data);
            const result = await opencode.session.prompt({
              path: { id: sessionId },
              body: {
                parts: [{ type: "text", text: prompt }],
              },
            });

            // 結果を送信
            ws.send(
              JSON.stringify({
                type: "response",
                message: extractText(result),
              })
            );

            log.info("OpenCode response sent", { sessionId });
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
      },

      onClose() {
        log.info("WS disconnected", { sessionId });
      },

      onError(error) {
        log.error("WS error", { error: String(error) });
      },
    };
  })
);

/**
 * Source Locator のコンテキスト付きプロンプトを構築
 */
function buildPrompt(data: {
  message: string;
  elementContext?: {
    ocId?: string;
    tag?: string;
    text?: string;
    classes?: string;
    componentTree?: { name: string; file: string }[];
  };
}): string {
  const parts: string[] = [];

  if (data.elementContext?.ocId) {
    const ctx = data.elementContext;
    parts.push("## 対象要素");
    if (ctx.ocId) parts.push(`- ID: ${ctx.ocId}`);
    if (ctx.tag) parts.push(`- タグ: ${ctx.tag}`);
    if (ctx.text) parts.push(`- テキスト: "${ctx.text}"`);
    if (ctx.classes) parts.push(`- クラス: ${ctx.classes}`);
    if (ctx.componentTree?.length) {
      parts.push(
        `- コンポーネント: ${ctx.componentTree.map((c) => c.name).join(" > ")}`
      );
      parts.push(`- ファイル: ${ctx.componentTree[0].file}`);
    }
    parts.push("");
  }

  parts.push("## ユーザーの指示");
  parts.push(data.message);

  return parts.join("\n");
}

/**
 * OpenCode のレスポンスからテキストを抽出
 */
function extractText(result: unknown): string {
  if (result && typeof result === "object" && "parts" in result) {
    const parts = (result as { parts: { type: string; text?: string }[] })
      .parts;
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }
  return String(result);
}

// エディター UI の静的ファイル配信（本番時: ビルド済み dist/）
if (process.env.NODE_ENV === "production") {
  app.use(
    "/*",
    serveStatic({ root: "../../editor/dist" })
  );
  // SPA フォールバック
  app.get("/*", serveStatic({ root: "../../editor/dist", path: "index.html" }));
}

const port = 8080;
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  log.info(`Agent Server started on 0.0.0.0:${port}`);
});

injectWebSocket(server);

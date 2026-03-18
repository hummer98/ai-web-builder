import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * HTTP ルートのみを持つ Hono app を作成する。
 * WebSocket・serve() は index.ts 側で追加する。
 */
export function createApp() {
  const app = new Hono();

  const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173";
  const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";

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

  // 画像アップロード
  app.post("/api/upload", async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!(file instanceof File)) {
        return c.json({ error: "No file provided" }, 400);
      }

      // ファイルサイズチェック
      if (file.size > MAX_UPLOAD_SIZE) {
        return c.json({ error: "File too large (max 5MB)" }, 413);
      }

      // 画像 MIME タイプチェック
      if (!file.type.startsWith("image/")) {
        return c.json({ error: "Only image files are allowed" }, 400);
      }

      const ext = extname(file.name) || ".png";
      const filename = `${randomUUID()}${ext}`;
      const uploadsDir = join(WORKSPACE_DIR, "public", "uploads");
      mkdirSync(uploadsDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(join(uploadsDir, filename), buffer);

      log.info("File uploaded", { filename, size: file.size });
      return c.json({ url: `/uploads/${filename}` });
    } catch (err) {
      log.error("Upload failed", { error: String(err) });
      return c.json({ error: "Upload failed" }, 500);
    }
  });

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

  // エディター UI の静的ファイル配信（本番時: ビルド済み dist/）
  if (process.env.NODE_ENV === "production") {
    app.use(
      "/*",
      serveStatic({ root: "../../editor/dist" })
    );
    // SPA フォールバック
    app.get("/*", serveStatic({ root: "../../editor/dist", path: "index.html" }));
  }

  return app;
}

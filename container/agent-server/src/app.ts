import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

const UPLOAD_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/**
 * HTTP ルートのみを持つ Hono app を作成する。
 * WebSocket・serve() は index.ts 側で追加する。
 */
export function createApp() {
  const app = new Hono();

  const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173";
  const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";

  // 認証ミドルウェア（/health, /ws は常に除外）
  app.use("*", async (c, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    if (c.req.path === "/health" || c.req.path === "/ws") return next();

    // DEMO_PASSWORD が設定されている場合: Basic 認証
    const demoPassword = process.env.DEMO_PASSWORD;
    if (demoPassword) {
      const auth = c.req.header("Authorization");
      if (auth?.startsWith("Basic ")) {
        const decoded = atob(auth.slice(6));
        const password = decoded.split(":").slice(1).join(":");
        if (password === demoPassword) return next();
      }
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="AI Web Builder Demo"' },
      });
    }

    // Cloudflare Access JWT 認証（設定されている環境のみ）
    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (jwt) return next();

    // 認証手段がどちらも設定されていない場合はスキップ（デモモード）
    if (!process.env.CLOUDFLARE_ACCESS_AUD) return next();

    log.warn("Access denied: no valid auth", {
      path: c.req.path,
      ip: c.req.header("x-forwarded-for") ?? "unknown",
    });
    return c.text("Unauthorized", 401);
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

  // ユーザーアップロード画像の直接配信 (/uploads/*)
  // 親 origin で配信することで AI が生成する <img src="/uploads/<uuid>.<ext>"> が
  // iframe からも本番 Cloudflare Pages からも動作する
  app.get("/uploads/*", async (c) => {
    const reqPath = c.req.path;
    const rest = reqPath.slice("/uploads/".length);

    if (
      !rest ||
      rest.includes("/") ||
      rest.includes("\\") ||
      rest.includes("..") ||
      rest.startsWith(".")
    ) {
      return c.text("Not Found", 404);
    }

    const ext = extname(rest).toLowerCase();
    const contentType = UPLOAD_MIME_TYPES[ext];
    if (!contentType) {
      return c.text("Not Found", 404);
    }

    const uploadsDir = resolve(WORKSPACE_DIR, "public", "uploads");
    const filePath = resolve(uploadsDir, rest);
    if (filePath !== uploadsDir + sep + rest) {
      return c.text("Not Found", 404);
    }

    try {
      const buffer = await readFile(filePath);
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return c.text("Not Found", 404);
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
  // /ws, /api, /preview, /health は除外（他のルートが処理する）
  if (process.env.NODE_ENV === "production") {
    app.use("/*", async (c, next) => {
      const path = c.req.path;
      if (
        path === "/ws" ||
        path.startsWith("/api") ||
        path.startsWith("/preview") ||
        path.startsWith("/uploads") ||
        path === "/health"
      ) {
        return next();
      }
      const mw = serveStatic({ root: "../../editor/dist" });
      return mw(c, next);
    });
    // SPA フォールバック（同じ除外条件）
    app.get("/*", async (c, next) => {
      const path = c.req.path;
      if (
        path === "/ws" ||
        path.startsWith("/api") ||
        path.startsWith("/preview") ||
        path.startsWith("/uploads") ||
        path === "/health"
      ) {
        return next();
      }
      const mw = serveStatic({ root: "../../editor/dist", path: "index.html" });
      return mw(c, next);
    });
  }

  return app;
}

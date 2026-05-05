import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "./logger.js";
import { createVerifier, type Verifier } from "./auth.js";
import { sanitizeError } from "./utils.js";
import { createSecretsRouter } from "./api-secrets.js";

const log = createLogger("agent-server");

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

const UPLOAD_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  // ".svg" は Stored XSS のため許可しない (T013)
};

export type CreateAppOpts = {
  /**
   * テスト用 verifier 注入。本番では未指定で
   * `createVerifier({ teamDomain, aud })` を内部生成する。
   */
  verifier?: Verifier;
};

/**
 * 起動時バリデーション。production 起動時に必要な認証手段が揃っているかを検査する。
 *
 * - DEMO_PASSWORD あり → Basic フォールバックで起動可
 * - DEMO_PASSWORD なし & CLOUDFLARE_ACCESS_AUD あり → JWT 検証必須 → TEAM_DOMAIN も必須
 * - 上記いずれもなし → デモモード警告のみ (ローカルから直公開時の互換)
 */
function ensureProductionAuthConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const demo = process.env.DEMO_PASSWORD;
  const aud = process.env.CLOUDFLARE_ACCESS_AUD;
  const team = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;

  if (demo) return;
  if (!aud) {
    log.warn(
      "production starting in demo mode (no DEMO_PASSWORD, no CLOUDFLARE_ACCESS_AUD)"
    );
    return;
  }
  if (!team) {
    throw new Error(
      "CLOUDFLARE_ACCESS_TEAM_DOMAIN is required when CLOUDFLARE_ACCESS_AUD is set in production"
    );
  }
}

/**
 * HTTP ルートのみを持つ Hono app を作成する。
 * WebSocket・serve() は index.ts 側で追加する。
 */
export function createApp(opts: CreateAppOpts = {}) {
  ensureProductionAuthConfig();

  const app = new Hono();

  const VITE_URL = process.env.VITE_URL ?? "http://localhost:5173";
  const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";

  // verifier の遅延生成 (DI が無いとき & JWT 必須運用のときのみ)
  let cachedVerifier: Verifier | undefined = opts.verifier;
  const getVerifier = (): Verifier | undefined => {
    if (cachedVerifier) return cachedVerifier;
    const aud = process.env.CLOUDFLARE_ACCESS_AUD;
    const team = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
    if (!aud || !team) return undefined;
    cachedVerifier = createVerifier({ teamDomain: team, aud });
    return cachedVerifier;
  };

  // 認証ミドルウェア（/health は常に除外。/ws は WS upgrade 時 Origin チェック追加）
  app.use("*", async (c, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    if (c.req.path === "/health") return next();

    // /ws upgrade に Origin ホワイトリストを適用 (M1: 設定済みなら欠落も拒否)
    if (c.req.path === "/ws") {
      const allowed = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowed.length > 0) {
        const origin = c.req.header("Origin");
        if (!origin || !allowed.includes(origin)) {
          log.warn("Origin rejected", { origin: origin ?? "(missing)" });
          return c.text("Forbidden", 403);
        }
      }
    }

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

    // Cloudflare Access JWT 検証
    const aud = process.env.CLOUDFLARE_ACCESS_AUD;
    if (!aud) {
      // 認証手段がどちらも設定されていない場合はスキップ（デモモード）
      return next();
    }

    const verifier = getVerifier();
    if (!verifier) {
      log.error("Verifier missing despite CLOUDFLARE_ACCESS_AUD set");
      return c.text("Unauthorized", 401);
    }

    const token =
      c.req.header("Cf-Access-Jwt-Assertion") ??
      getCookie(c, "CF_Authorization");
    if (!token) {
      log.warn("Access denied: JWT missing", {
        path: c.req.path,
        ip: c.req.header("x-forwarded-for") ?? "unknown",
      });
      return c.text("Unauthorized", 401);
    }

    const r = await verifier(token);
    if (!r.ok) {
      // セキュリティ要件: トークン本体・payload はログに出さない (m6)
      log.warn("Access denied: JWT verify failed", {
        path: c.req.path,
        ip: c.req.header("x-forwarded-for") ?? "unknown",
        error: r.error,
      });
      return c.text("Unauthorized", 401);
    }

    return next();
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // BYOK: シークレット管理 API (T017)
  app.route("/api/secrets", createSecretsRouter());

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

      // 拡張子ホワイトリスト検証 (T013: SVG 等の XSS 経路を遮断する二重防御)
      const ext = (extname(file.name) || ".png").toLowerCase();
      if (!UPLOAD_MIME_TYPES[ext]) {
        return c.json({ error: "Unsupported file type" }, 415);
      }
      const filename = `${randomUUID()}${ext}`;
      const uploadsDir = join(WORKSPACE_DIR, "public", "uploads");
      await mkdir(uploadsDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(join(uploadsDir, filename), buffer);

      log.info("File uploaded", { filename, size: file.size });
      return c.json({ url: `/uploads/${filename}` });
    } catch (err) {
      log.error("Upload failed", { error: sanitizeError(err) });
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
    const isReservedPath = (path: string): boolean =>
      path === "/ws" ||
      path === "/health" ||
      path.startsWith("/api") ||
      path.startsWith("/preview") ||
      path.startsWith("/uploads");

    app.use("/*", async (c, next) => {
      if (isReservedPath(c.req.path)) return next();
      const mw = serveStatic({ root: "../../editor/dist" });
      return mw(c, next);
    });
    // SPA フォールバック（同じ除外条件）
    app.get("/*", async (c, next) => {
      if (isReservedPath(c.req.path)) return next();
      const mw = serveStatic({ root: "../../editor/dist", path: "index.html" });
      return mw(c, next);
    });
  }

  return app;
}

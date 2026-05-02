import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
  type JWK,
} from "jose";
import type { Verifier } from "./auth.js";

let tmpDir: string;

const TEAM_DOMAIN = "test.cloudflareaccess.com";
const AUD = "test-aud-prod";

type KeyMaterial = { privateKey: CryptoKey; publicJwk: JWK };

async function makeKey(kid: string): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { privateKey, publicJwk: jwk };
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  opts: { aud?: string; iss?: string; expSec?: number } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(opts.iss ?? `https://${TEAM_DOMAIN}`)
    .setAudience(opts.aud ?? AUD)
    .setSubject("user@example.com")
    .setIssuedAt(now)
    .setExpirationTime(opts.expSec ?? now + 600)
    .sign(privateKey);
}

async function makeJwksFn(keys: KeyMaterial[]) {
  return async (header: { kid?: string }): Promise<CryptoKey> => {
    const k = keys.find((k) => k.publicJwk.kid === header.kid);
    if (!k) throw new Error(`unknown kid: ${header.kid}`);
    return (await importJWK(k.publicJwk, "RS256")) as CryptoKey;
  };
}

describe("app HTTP routes", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "app-test-"));
    vi.stubEnv("WORKSPACE_DIR", tmpDir);
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function getApp() {
    const { createApp } = await import("./app.js");
    return createApp();
  }

  async function getAppWithVerifier(verifier: Verifier) {
    const { createApp } = await import("./app.js");
    return createApp({ verifier });
  }

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------
  describe("GET /health", () => {
    it("returns 200 with { status: 'ok' }", async () => {
      const app = await getApp();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/upload
  // -------------------------------------------------------------------------
  describe("POST /api/upload", () => {
    it("uploads a valid image file and returns URL", async () => {
      const app = await getApp();
      const formData = new FormData();
      const file = new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47])], // PNG header bytes
        "test.png",
        { type: "image/png" }
      );
      formData.append("file", file);

      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { url: string };
      expect(json.url).toMatch(/^\/uploads\/.*\.png$/);

      // ファイルが実際にディスク上に存在することを確認
      const filename = json.url.replace("/uploads/", "");
      const filePath = join(tmpDir, "public", "uploads", filename);
      expect(existsSync(filePath)).toBe(true);
    });

    it("returns 400 when no file is provided", async () => {
      const app = await getApp();
      const formData = new FormData();
      // "file" フィールドなし

      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("No file provided");
    });

    it("returns 413 when file exceeds 5MB", async () => {
      const app = await getApp();
      const formData = new FormData();
      const bigBuffer = new Uint8Array(6 * 1024 * 1024); // 6MB
      const file = new File([bigBuffer], "big.png", { type: "image/png" });
      formData.append("file", file);

      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(413);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("File too large");
    });

    it("returns 400 when file is not an image", async () => {
      const app = await getApp();
      const formData = new FormData();
      const file = new File(["hello world"], "readme.txt", {
        type: "text/plain",
      });
      formData.append("file", file);

      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Only image files are allowed");
    });
  });

  // -------------------------------------------------------------------------
  // GET /uploads/*
  // -------------------------------------------------------------------------
  describe("GET /uploads/*", () => {
    const placeFile = (name: string, bytes: Uint8Array) => {
      const dir = join(tmpDir, "public", "uploads");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), bytes);
    };

    it("returns 200 with correct Content-Type for .png", async () => {
      const app = await getApp();
      placeFile("a.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      const res = await app.request("/uploads/a.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(buf[0]).toBe(0x89);
    });

    it("returns 200 with image/jpeg for .jpg and .jpeg", async () => {
      const app = await getApp();
      placeFile("a.jpg", new Uint8Array([0xff, 0xd8]));
      placeFile("b.jpeg", new Uint8Array([0xff, 0xd8]));
      const r1 = await app.request("/uploads/a.jpg");
      const r2 = await app.request("/uploads/b.jpeg");
      expect(r1.headers.get("content-type")).toBe("image/jpeg");
      expect(r2.headers.get("content-type")).toBe("image/jpeg");
    });

    it("returns 200 with image/webp / image/gif / image/svg+xml", async () => {
      const app = await getApp();
      placeFile("a.webp", new Uint8Array([0x52, 0x49, 0x46, 0x46]));
      placeFile("a.gif", new Uint8Array([0x47, 0x49, 0x46]));
      placeFile("a.svg", new TextEncoder().encode("<svg/>"));
      expect((await app.request("/uploads/a.webp")).headers.get("content-type")).toBe("image/webp");
      expect((await app.request("/uploads/a.gif")).headers.get("content-type")).toBe("image/gif");
      expect((await app.request("/uploads/a.svg")).headers.get("content-type")).toBe("image/svg+xml");
    });

    it("treats uppercase extension as same MIME (.PNG → image/png)", async () => {
      const app = await getApp();
      placeFile("BIG.PNG", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      const res = await app.request("/uploads/BIG.PNG");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("returns 404 for missing file", async () => {
      const app = await getApp();
      const res = await app.request("/uploads/does-not-exist.png");
      expect(res.status).toBe(404);
    });

    it("returns 404 for path traversal attempt (../etc/passwd)", async () => {
      const app = await getApp();
      const res = await app.request("/uploads/..%2Fetc%2Fpasswd");
      expect(res.status).toBe(404);
    });

    it("returns 404 for path containing '..' segment (decoded)", async () => {
      const app = await getApp();
      const res = await app.request("/uploads/..");
      expect(res.status).toBe(404);
    });

    it("returns 404 for nested path (subdirectory not allowed)", async () => {
      const app = await getApp();
      placeFile("a.png", new Uint8Array([0x89]));
      const res = await app.request("/uploads/sub/a.png");
      expect(res.status).toBe(404);
    });

    it("returns 404 for dotfile (.env)", async () => {
      const app = await getApp();
      placeFile(".env", new TextEncoder().encode("SECRET=1"));
      const res = await app.request("/uploads/.env");
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-allowed extension (.txt) even if file exists", async () => {
      const app = await getApp();
      placeFile("a.txt", new TextEncoder().encode("hello"));
      const res = await app.request("/uploads/a.txt");
      expect(res.status).toBe(404);
    });

    it("returns 404 when WORKSPACE_DIR/public/uploads does not exist yet", async () => {
      const app = await getApp();
      const res = await app.request("/uploads/anything.png");
      expect(res.status).toBe(404);
    });

    it("end-to-end: POST /api/upload then GET /uploads/<returned>", async () => {
      const app = await getApp();
      const formData = new FormData();
      const file = new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
        "test.png",
        { type: "image/png" }
      );
      formData.append("file", file);
      const upload = await app.request("/api/upload", { method: "POST", body: formData });
      const { url } = (await upload.json()) as { url: string };
      expect(url).toMatch(/^\/uploads\/.+\.png$/);

      const get = await app.request(url);
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toBe("image/png");
    });

    it("does not fall through to SPA fallback for /uploads/* (production)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      const app = await getApp();
      const res = await app.request("/uploads/missing.png");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
    });
  });

  // -------------------------------------------------------------------------
  // 認証ミドルウェア (NODE_ENV=production)
  // -------------------------------------------------------------------------
  describe("auth middleware (production)", () => {
    it("/health bypasses auth even in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      const app = await getApp();

      const res = await app.request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });

    it("returns 401 without JWT when CLOUDFLARE_ACCESS_AUD is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();
      const verifier: Verifier = async () => ({ ok: false, error: "n/a" });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/api/upload", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("allows requests with valid JWT (Cf-Access-Jwt-Assertion header)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();

      const key = await makeKey("k1");
      const jwks = await makeJwksFn([key]);
      const { createVerifier } = await import("./auth.js");
      const verifier = createVerifier({
        teamDomain: TEAM_DOMAIN,
        aud: AUD,
        jwks,
      });
      const app = await getAppWithVerifier(verifier);

      const token = await signToken(key.privateKey, "k1");
      const formData = new FormData();
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
        headers: { "Cf-Access-Jwt-Assertion": token },
      });
      // 認証は通過 → 400 (file なし)
      expect(res.status).toBe(400);
    });

    it("returns 401 for invalid JWT (random string)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();

      const key = await makeKey("k1");
      const jwks = await makeJwksFn([key]);
      const { createVerifier } = await import("./auth.js");
      const verifier = createVerifier({
        teamDomain: TEAM_DOMAIN,
        aud: AUD,
        jwks,
      });
      const app = await getAppWithVerifier(verifier);

      const formData = new FormData();
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
        headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 for AUD-mismatched JWT", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();

      const key = await makeKey("k1");
      const jwks = await makeJwksFn([key]);
      const { createVerifier } = await import("./auth.js");
      const verifier = createVerifier({
        teamDomain: TEAM_DOMAIN,
        aud: AUD,
        jwks,
      });
      const app = await getAppWithVerifier(verifier);

      const token = await signToken(key.privateKey, "k1", {
        aud: "wrong-aud",
      });
      const formData = new FormData();
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
        headers: { "Cf-Access-Jwt-Assertion": token },
      });
      expect(res.status).toBe(401);
    });

    it("allows requests with valid JWT in CF_Authorization Cookie", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();

      const key = await makeKey("k1");
      const jwks = await makeJwksFn([key]);
      const { createVerifier } = await import("./auth.js");
      const verifier = createVerifier({
        teamDomain: TEAM_DOMAIN,
        aud: AUD,
        jwks,
      });
      const app = await getAppWithVerifier(verifier);

      const token = await signToken(key.privateKey, "k1");
      const formData = new FormData();
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
        headers: { Cookie: `CF_Authorization=${token}` },
      });
      expect(res.status).toBe(400); // 認証通過 → file なしで 400
    });

    it("/preview/* also requires JWT in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();
      const verifier: Verifier = async () => ({ ok: false, error: "n/a" });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/preview/index.html");
      expect(res.status).toBe(401);
    });

    it("/uploads/* also requires JWT in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();
      const verifier: Verifier = async () => ({ ok: false, error: "n/a" });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/uploads/anything.png");
      expect(res.status).toBe(401);
    });

    it("DEMO_PASSWORD basic auth still works", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEMO_PASSWORD", "p4ss");
      vi.resetModules();
      const app = await getApp();

      const formData = new FormData();
      const cred = "Basic " + btoa("anyuser:p4ss");
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
        headers: { Authorization: cred },
      });
      // 認証通過 → file なしで 400
      expect(res.status).toBe(400);
    });

    it("CLOUDFLARE_ACCESS_AUD unset → demo mode (no JWT required)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      const app = await getApp();

      const formData = new FormData();
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(400); // 認証通過 → file なしで 400
    });
  });

  // -------------------------------------------------------------------------
  // /ws の Origin チェック (Step 3)
  // -------------------------------------------------------------------------
  describe("/ws origin & auth (production)", () => {
    it("returns 401 for /ws without JWT when AUD set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.resetModules();
      const verifier: Verifier = async () => ({ ok: false, error: "n/a" });
      const app = await getAppWithVerifier(verifier);

      // Hono は /ws のハンドラを登録していないが、ミドルウェアで 401 になる
      const res = await app.request("/ws", {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 for /ws when Origin is not in ALLOWED_ORIGINS", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.stubEnv("ALLOWED_ORIGINS", "https://allowed.example");
      vi.resetModules();
      const verifier: Verifier = async () => ({
        ok: true,
        payload: { sub: "u" },
      });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/ws", {
        headers: {
          Upgrade: "websocket",
          Origin: "https://evil.example",
          "Cf-Access-Jwt-Assertion": "any",
        },
      });
      expect(res.status).toBe(403);
    });

    it("M1: returns 403 for /ws when Origin is missing AND ALLOWED_ORIGINS is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.stubEnv("ALLOWED_ORIGINS", "https://allowed.example");
      vi.resetModules();
      const verifier: Verifier = async () => ({
        ok: true,
        payload: { sub: "u" },
      });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/ws", {
        headers: {
          Upgrade: "websocket",
          // Origin ヘッダーなし
          "Cf-Access-Jwt-Assertion": "any",
        },
      });
      expect(res.status).toBe(403);
    });

    it("/ws passes middleware when Origin allowed and JWT valid (no upgrade handler in test app → 404)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      vi.stubEnv("ALLOWED_ORIGINS", "https://allowed.example");
      vi.resetModules();
      const verifier: Verifier = async () => ({
        ok: true,
        payload: { sub: "u" },
      });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/ws", {
        headers: {
          Upgrade: "websocket",
          Origin: "https://allowed.example",
          "Cf-Access-Jwt-Assertion": "any",
        },
      });
      // /ws ハンドラは createApp 内で登録されないので 404 (= ミドルウェア通過の証明)
      expect(res.status).toBe(404);
    });

    it("/ws is unrestricted when ALLOWED_ORIGINS is unset (curl friendly)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", AUD);
      vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", TEAM_DOMAIN);
      // ALLOWED_ORIGINS は未設定
      vi.resetModules();
      const verifier: Verifier = async () => ({
        ok: true,
        payload: { sub: "u" },
      });
      const app = await getAppWithVerifier(verifier);

      const res = await app.request("/ws", {
        headers: {
          Upgrade: "websocket",
          // Origin なしでもオリジン検査は通る
          "Cf-Access-Jwt-Assertion": "any",
        },
      });
      // ハンドラ未登録 → 404
      expect(res.status).toBe(404);
    });
  });
});

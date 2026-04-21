import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

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
    it("returns 401 without Cf-Access-Jwt-Assertion header when CLOUDFLARE_ACCESS_AUD is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "dummy-aud");
      vi.resetModules();
      const app = await getApp();

      const res = await app.request("/api/upload", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("/health bypasses auth even in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      const app = await getApp();

      const res = await app.request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });

    it("allows requests with Cf-Access-Jwt-Assertion header", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      const app = await getApp();

      const formData = new FormData();
      // file なしなので 400 が返るが、401 ではないことを確認
      const res = await app.request("/api/upload", {
        method: "POST",
        body: formData,
        headers: { "Cf-Access-Jwt-Assertion": "dummy-jwt-token" },
      });
      // 認証は通過 → 400 (ファイルなし)
      expect(res.status).toBe(400);
    });
  });
});

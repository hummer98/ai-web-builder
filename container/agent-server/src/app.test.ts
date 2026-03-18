import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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
  // 認証ミドルウェア (NODE_ENV=production)
  // -------------------------------------------------------------------------
  describe("auth middleware (production)", () => {
    it("returns 401 without Cf-Access-Jwt-Assertion header", async () => {
      vi.stubEnv("NODE_ENV", "production");
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

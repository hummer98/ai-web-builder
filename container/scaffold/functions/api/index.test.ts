import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "./index.js";

let tmpDir: string;
const origCwd = process.cwd();

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "scaffold-api-"));
  process.chdir(tmpDir);
});
afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/contact", () => {
  const validBody = { name: "Yuji", email: "y@example.com", message: "Hello" };

  it("accepts valid body (200)", async () => {
    const res = await app.request("/api/contact", {
      method: "POST",
      body: JSON.stringify(validBody),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("rejects missing field (400)", async () => {
    const res = await app.request("/api/contact", {
      method: "POST",
      body: JSON.stringify({ name: "x", email: "y@x.com" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid email (400)", async () => {
    const res = await app.request("/api/contact", {
      method: "POST",
      body: JSON.stringify({ ...validBody, email: "not-an-email" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects email with newline injection (400)", async () => {
    const res = await app.request("/api/contact", {
      method: "POST",
      body: JSON.stringify({
        ...validBody,
        email: 'y@x.com\n{"injected":1}',
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects too-long message (400)", async () => {
    const res = await app.request("/api/contact", {
      method: "POST",
      body: JSON.stringify({ ...validBody, message: "x".repeat(5001) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let secretsPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "api-secrets-test-"));
  secretsPath = join(tmpDir, "secrets.json");
  vi.stubEnv("SECRETS_FILE", secretsPath);
  vi.stubEnv("NODE_ENV", "test");
  vi.resetModules();
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

interface SecretStatusResponse {
  openrouter: { set: boolean; last4?: string };
  gemini: { set: boolean; last4?: string };
  cloudflare: { set: boolean; last4?: string; accountId?: string };
  firebase: { set: boolean; last4?: string };
}

describe("api-secrets", () => {
  it("GET /api/secrets initial state is all false", async () => {
    const app = await getApp();
    const res = await app.request("/api/secrets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecretStatusResponse;
    expect(body).toEqual({
      openrouter: { set: false },
      gemini: { set: false },
      cloudflare: { set: false },
      firebase: { set: false },
    });
  });

  it("PUT openrouter then GET shows last4", async () => {
    const app = await getApp();
    const put = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openrouter: { apiKey: "sk-test-1234abcd" } }),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as SecretStatusResponse;
    expect(putBody.openrouter.set).toBe(true);
    expect(putBody.openrouter.last4).toBe("abcd");

    const get = await app.request("/api/secrets");
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as SecretStatusResponse;
    expect(getBody.openrouter.set).toBe(true);
    expect(getBody.openrouter.last4).toBe("abcd");
  });

  it("PUT gemini only preserves openrouter", async () => {
    const app = await getApp();
    const r1 = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openrouter: { apiKey: "sk-test-1111aaaa" } }),
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gemini: { apiKey: "gem-9999" } }),
    });
    expect(r2.status).toBe(200);
    const body = (await r2.json()) as SecretStatusResponse;
    expect(body.openrouter.set).toBe(true);
    expect(body.openrouter.last4).toBe("aaaa");
    expect(body.gemini.set).toBe(true);
    expect(body.gemini.last4).toBe("9999");
  });

  it("DELETE openrouter clears it", async () => {
    const app = await getApp();
    const put = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openrouter: { apiKey: "sk-test-zzzz" } }),
    });
    expect(put.status).toBe(200);

    const del = await app.request("/api/secrets/openrouter", {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const body = (await del.json()) as SecretStatusResponse;
    expect(body.openrouter.set).toBe(false);
  });

  it("PUT with empty apiKey returns 400 invalid_request", async () => {
    const app = await getApp();
    const res = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openrouter: { apiKey: "" } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "invalid_request" });
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("responses never leak secret bodies", async () => {
    const SECRET = "sk-or-AAAAAAAA1234";
    const app = await getApp();
    const put = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openrouter: { apiKey: SECRET } }),
    });
    const putText = await put.text();
    expect(putText).not.toContain(SECRET);

    const get = await app.request("/api/secrets");
    const getText = await get.text();
    expect(getText).not.toContain(SECRET);
    // last4 のみは公開される
    expect(getText).toContain("1234");
  });

  it("DELETE /api/secrets/unknown returns 404 invalid_request", async () => {
    const app = await getApp();
    const res = await app.request("/api/secrets/unknown", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "invalid_request" });
  });

  it("PUT with non-JSON body returns 400 invalid_request", async () => {
    const app = await getApp();
    const res = await app.request("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "invalid_request" });
  });
});

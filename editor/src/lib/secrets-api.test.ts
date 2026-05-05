import { describe, it, expect, vi } from "vitest";
import {
  fetchSecretStatus,
  putSecrets,
  deleteSecret,
  SecretsApiError,
} from "./secrets-api";
import type { SecretStatus } from "../types/secrets";

const STATUS_OK: SecretStatus = {
  openrouter: { set: true, last4: "abcd" },
  gemini: { set: false },
  cloudflare: { set: false },
  firebase: { set: false },
};

function makeFetcher(
  ok: boolean,
  body: unknown,
  status = ok ? 200 : 400,
): typeof fetch {
  return vi.fn(async () => {
    const init: ResponseInit = { status };
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      init,
    );
  }) as unknown as typeof fetch;
}

describe("fetchSecretStatus", () => {
  it("GETs /api/secrets and returns parsed status", async () => {
    const fetcher = makeFetcher(true, STATUS_OK);
    const result = await fetchSecretStatus(fetcher);
    expect(result).toEqual(STATUS_OK);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/secrets",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws SecretsApiError on non-2xx response", async () => {
    const fetcher = makeFetcher(false, { error: "internal_error" }, 500);
    await expect(fetchSecretStatus(fetcher)).rejects.toBeInstanceOf(
      SecretsApiError,
    );
  });

  it("rethrows network errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    await expect(fetchSecretStatus(fetcher)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("putSecrets", () => {
  it("PUTs /api/secrets with JSON body and returns updated status", async () => {
    const fetcher = makeFetcher(true, STATUS_OK);
    const update = { openrouter: { apiKey: "sk-xxx" } };
    const result = await putSecrets(update, fetcher);
    expect(result).toEqual(STATUS_OK);
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call[0]).toBe("/api/secrets");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify(update));
    expect(init.credentials).toBe("same-origin");
  });

  it("throws SecretsApiError with status code on validation failure", async () => {
    const fetcher = makeFetcher(false, { error: "invalid_request" }, 400);
    await expect(
      putSecrets({ openrouter: { apiKey: "" } }, fetcher),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("includes the API error code in the message when provided", async () => {
    const fetcher = makeFetcher(false, { error: "invalid_request" }, 400);
    await expect(
      putSecrets({ openrouter: { apiKey: "" } }, fetcher),
    ).rejects.toThrow(/invalid_request/);
  });
});

describe("deleteSecret", () => {
  it("DELETEs /api/secrets/:provider and returns updated status", async () => {
    const fetcher = makeFetcher(true, STATUS_OK);
    const result = await deleteSecret("openrouter", fetcher);
    expect(result).toEqual(STATUS_OK);
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call[0]).toBe("/api/secrets/openrouter");
    expect((call[1] as RequestInit).method).toBe("DELETE");
  });

  it("throws SecretsApiError on 404", async () => {
    const fetcher = makeFetcher(false, { error: "invalid_request" }, 404);
    await expect(deleteSecret("openrouter", fetcher)).rejects.toMatchObject({
      status: 404,
    });
  });
});

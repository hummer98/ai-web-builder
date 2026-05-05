// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSecrets } from "./useSecrets";
import type { SecretStatus } from "../types/secrets";

const STATUS_EMPTY: SecretStatus = {
  openrouter: { set: false },
  gemini: { set: false },
  cloudflare: { set: false },
  firebase: { set: false },
};

const STATUS_OR_SET: SecretStatus = {
  openrouter: { set: true, last4: "abcd" },
  gemini: { set: false },
  cloudflare: { set: false },
  firebase: { set: false },
};

function mockFetchOnce(body: unknown, ok = true, status = ok ? 200 : 400) {
  const fn = vi.fn(async () => {
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  globalThis.fetch = fn;
  return fn;
}

function mockFetchSequence(
  responses: Array<{ body: unknown; status?: number }>,
) {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  globalThis.fetch = fn;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSecrets", () => {
  it("fetches initial status on mount", async () => {
    mockFetchOnce(STATUS_EMPTY);
    const { result } = renderHook(() => useSecrets());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toEqual(STATUS_EMPTY);
    expect(result.current.error).toBeNull();
  });

  it("save() updates status on success and returns ok", async () => {
    mockFetchSequence([{ body: STATUS_EMPTY }, { body: STATUS_OR_SET }]);
    const { result } = renderHook(() => useSecrets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await result.current.save({ openrouter: { apiKey: "sk-xxx" } });
    });
    expect(res).toEqual({ ok: true });
    expect(result.current.status).toEqual(STATUS_OR_SET);
  });

  it("save() sets UX-translated error string on API failure", async () => {
    mockFetchSequence([
      { body: STATUS_EMPTY },
      { body: { error: "invalid_request" }, status: 400 },
    ]);
    const { result } = renderHook(() => useSecrets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await result.current.save({ openrouter: { apiKey: "x" } });
    });
    expect(res).toEqual({ ok: false });
    expect(result.current.error).toBe("保存に失敗しました");
    expect(result.current.error).not.toMatch(/invalid_request/);
  });

  it("remove() updates status on success", async () => {
    mockFetchSequence([{ body: STATUS_OR_SET }, { body: STATUS_EMPTY }]);
    const { result } = renderHook(() => useSecrets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("openrouter");
    });
    expect(result.current.status).toEqual(STATUS_EMPTY);
  });

  it("remove() sets UX-translated error on failure", async () => {
    mockFetchSequence([
      { body: STATUS_OR_SET },
      { body: { error: "invalid_request" }, status: 404 },
    ]);
    const { result } = renderHook(() => useSecrets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("openrouter");
    });
    expect(result.current.error).toBe("削除に失敗しました");
  });

  it("sets UX-translated error on initial load failure", async () => {
    mockFetchOnce({ error: "internal_error" }, false, 500);
    const { result } = renderHook(() => useSecrets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("読み込みに失敗しました");
  });

  it("blocks concurrent save by tracking saving provider", async () => {
    let resolveSecond: (() => void) | undefined;
    const callOrder: string[] = [];
    const fn = vi.fn(async (input: unknown) => {
      const url = String(input);
      callOrder.push(url);
      if (callOrder.length === 1) {
        // initial GET
        return new Response(JSON.stringify(STATUS_EMPTY), { status: 200 });
      }
      // save call: pause until released
      await new Promise<void>((r) => {
        resolveSecond = r;
      });
      return new Response(JSON.stringify(STATUS_OR_SET), { status: 200 });
    }) as unknown as typeof fetch;
    globalThis.fetch = fn;

    const { result } = renderHook(() => useSecrets());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let p1: Promise<{ ok: boolean }>;
    act(() => {
      p1 = result.current.save({ openrouter: { apiKey: "a" } });
    });
    await waitFor(() =>
      expect(result.current.saving).toBe("openrouter"),
    );
    // Second save while first is in flight should be no-op (ok:false)
    let res2: { ok: boolean } | undefined;
    await act(async () => {
      res2 = await result.current.save({ gemini: { apiKey: "b" } });
    });
    expect(res2).toEqual({ ok: false });

    resolveSecond?.();
    await act(async () => {
      await p1!;
    });
    expect(result.current.saving).toBeNull();
  });
});

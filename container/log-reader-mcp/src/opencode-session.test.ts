import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listOpencodeSessions, readOpencodeSession } from "./handlers.js";

function text(result: { content: { text: string }[] }): string {
  return result.content[0].text;
}

function mockFetch(handler: (url: string) => { ok: boolean; status?: number; json: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const r = handler(String(url));
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
    } as Response;
  }));
}

describe("opencode session handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("listOpencodeSessions", () => {
    it("id\\ttitle の行で一覧する", async () => {
      mockFetch(() => ({
        ok: true,
        json: [
          { id: "ses_1", title: "画面が真っ黒な問題" },
          { id: "ses_2", title: "色を変える" },
        ],
      }));
      const t = text(await listOpencodeSessions());
      expect(t).toContain("ses_1\t画面が真っ黒な問題");
      expect(t).toContain("ses_2\t色を変える");
    });

    it("non-OK レスポンスはステータスを返す", async () => {
      mockFetch(() => ({ ok: false, status: 503, json: null }));
      expect(text(await listOpencodeSessions())).toContain("503");
    });

    it("API 到達不能はエラーメッセージを返す (例外を投げない)", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }));
      expect(text(await listOpencodeSessions())).toContain("unreachable");
    });

    it("OPENCODE_URL を尊重する", async () => {
      vi.stubEnv("OPENCODE_URL", "http://example:9999");
      const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] } as Response));
      vi.stubGlobal("fetch", spy);
      await listOpencodeSessions();
      expect(spy).toHaveBeenCalledWith("http://example:9999/session");
    });
  });

  describe("readOpencodeSession", () => {
    const messages = [
      {
        parts: [
          { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/App.tsx" }, output: "ok" } },
          { type: "tool", tool: "edit", state: { status: "error", input: { filePath: "src/x.tsx" }, error: "patch failed" } },
        ],
      },
      {
        parts: [
          { type: "text", text: "考え中..." },
          { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm run build" }, output: "done" } },
        ],
      },
    ];

    it("ツール呼び出しを status/入力/出力/エラー付きで要約する", async () => {
      mockFetch(() => ({ ok: true, json: messages }));
      const t = text(await readOpencodeSession({ sessionId: "ses_1", tail: 50 }));
      expect(t).toContain("3 tool calls");
      expect(t).toContain("[completed] read file=src/App.tsx → ok");
      expect(t).toContain("[error] edit file=src/x.tsx ERROR: patch failed");
      expect(t).toContain("[completed] bash cmd=npm run build → done");
    });

    it("text パートは無視する (ツールのみ)", async () => {
      mockFetch(() => ({ ok: true, json: messages }));
      const t = text(await readOpencodeSession({ sessionId: "ses_1", tail: 50 }));
      expect(t).not.toContain("考え中");
    });

    it("tail で末尾 N 件に絞る", async () => {
      mockFetch(() => ({ ok: true, json: messages }));
      const t = text(await readOpencodeSession({ sessionId: "ses_1", tail: 1 }));
      expect(t).toContain("showing last 1");
      expect(t).toContain("bash");
      expect(t).not.toContain("read file=src/App.tsx");
    });

    it("長い出力を truncate する", async () => {
      const big = "x".repeat(1000);
      mockFetch(() => ({
        ok: true,
        json: [{ parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: big } }] }],
      }));
      const t = text(await readOpencodeSession({ sessionId: "ses_1", tail: 50 }));
      expect(t).toContain("+700 chars");
      expect(t.length).toBeLessThan(big.length);
    });

    it("API 到達不能はエラーメッセージを返す", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }));
      expect(text(await readOpencodeSession({ sessionId: "ses_1", tail: 50 }))).toContain("unreachable");
    });
  });
});

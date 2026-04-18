import { describe, it, expect } from "vitest";
import { parseWsMessage } from "./ws-schema.js";

describe("parseWsMessage", () => {
  describe("正常系", () => {
    it("chat メッセージ", () => {
      const res = parseWsMessage(
        JSON.stringify({ type: "chat", message: "ヘッダーを青くして" })
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.type).toBe("chat");
    });

    it("chat + elementContext", () => {
      const res = parseWsMessage(
        JSON.stringify({
          type: "chat",
          message: "色を変えて",
          elementContext: {
            ocId: "abc-123",
            tag: "div",
            componentTree: [{ name: "Header", file: "src/Header.tsx" }],
          },
        })
      );
      expect(res.ok).toBe(true);
    });

    it("undo", () => {
      const res = parseWsMessage(JSON.stringify({ type: "undo" }));
      expect(res.ok).toBe(true);
    });

    it("history（count 省略可）", () => {
      expect(parseWsMessage(JSON.stringify({ type: "history" })).ok).toBe(true);
      expect(
        parseWsMessage(JSON.stringify({ type: "history", count: 10 })).ok
      ).toBe(true);
    });

    it("revert（hex hash 必須）", () => {
      expect(
        parseWsMessage(JSON.stringify({ type: "revert", hash: "abc123" })).ok
      ).toBe(true);
    });

    it("deploy / create-site / import-repo", () => {
      expect(parseWsMessage(JSON.stringify({ type: "deploy" })).ok).toBe(true);
      expect(
        parseWsMessage(
          JSON.stringify({ type: "create-site", owner: "u", siteName: "s" })
        ).ok
      ).toBe(true);
      expect(
        parseWsMessage(
          JSON.stringify({ type: "import-repo", owner: "u", repoName: "r" })
        ).ok
      ).toBe(true);
    });
  });

  describe("異常系", () => {
    it("不正な JSON → invalid-json", () => {
      const res = parseWsMessage("not-json{");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("invalid-json");
    });

    it("未知の type → invalid-shape", () => {
      const res = parseWsMessage(JSON.stringify({ type: "unknown" }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("invalid-shape");
    });

    it("chat で message が空 → invalid-shape", () => {
      const res = parseWsMessage(
        JSON.stringify({ type: "chat", message: "" })
      );
      expect(res.ok).toBe(false);
    });

    it("revert で hash が非 hex → invalid-shape", () => {
      const res = parseWsMessage(
        JSON.stringify({ type: "revert", hash: "not-hex!" })
      );
      expect(res.ok).toBe(false);
    });

    it("create-site で owner 欠落 → invalid-shape", () => {
      const res = parseWsMessage(
        JSON.stringify({ type: "create-site", siteName: "s" })
      );
      expect(res.ok).toBe(false);
    });

    it("null 入力", () => {
      const res = parseWsMessage("null");
      expect(res.ok).toBe(false);
    });
  });
});

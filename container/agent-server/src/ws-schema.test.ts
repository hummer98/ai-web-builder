import { describe, it, expect } from "vitest";
import { parseWsMessage } from "./ws-schema.js";

describe("parseWsMessage", () => {
  describe("chat", () => {
    it("accepts minimal chat message", () => {
      const r = parseWsMessage({ type: "chat", message: "hi" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.type).toBe("chat");
    });

    it("accepts chat with imageUrl and elementContext", () => {
      const r = parseWsMessage({
        type: "chat",
        message: "edit",
        imageUrl: "/uploads/abc.png",
        elementContext: {
          ocId: "oc-1",
          tag: "div",
          text: "hello",
          classes: "p-4",
          componentTree: [{ name: "Header", file: "src/Header.tsx" }],
        },
      });
      expect(r.ok).toBe(true);
    });

    it("rejects chat with non-string message", () => {
      const r = parseWsMessage({ type: "chat", message: 123 });
      expect(r.ok).toBe(false);
    });
  });

  describe("revert", () => {
    it("accepts a 7-char hex hash", () => {
      const r = parseWsMessage({ type: "revert", hash: "a1b2c3d" });
      expect(r.ok).toBe(true);
    });

    it("accepts a 40-char hex hash", () => {
      const r = parseWsMessage({
        type: "revert",
        hash: "0123456789abcdef0123456789abcdef01234567",
      });
      expect(r.ok).toBe(true);
    });

    it("rejects 3-char hash", () => {
      const r = parseWsMessage({ type: "revert", hash: "abc" });
      expect(r.ok).toBe(false);
    });

    it("rejects non-hex hash", () => {
      const r = parseWsMessage({ type: "revert", hash: "xyz1234" });
      expect(r.ok).toBe(false);
    });

    it("rejects upper-case hash", () => {
      const r = parseWsMessage({ type: "revert", hash: "ABCDEF1" });
      expect(r.ok).toBe(false);
    });
  });

  describe("history", () => {
    it("accepts count 50", () => {
      const r = parseWsMessage({ type: "history", count: 50 });
      expect(r.ok).toBe(true);
    });

    it("accepts no count (optional)", () => {
      const r = parseWsMessage({ type: "history" });
      expect(r.ok).toBe(true);
    });

    it("rejects count 0", () => {
      const r = parseWsMessage({ type: "history", count: 0 });
      expect(r.ok).toBe(false);
    });

    it("rejects count 101", () => {
      const r = parseWsMessage({ type: "history", count: 101 });
      expect(r.ok).toBe(false);
    });

    it("rejects count -1", () => {
      const r = parseWsMessage({ type: "history", count: -1 });
      expect(r.ok).toBe(false);
    });

    it("rejects non-integer count", () => {
      const r = parseWsMessage({ type: "history", count: 5.5 });
      expect(r.ok).toBe(false);
    });
  });

  describe("create-site", () => {
    it("accepts valid siteName", () => {
      const r = parseWsMessage({ type: "create-site", siteName: "my-site_1" });
      expect(r.ok).toBe(true);
    });

    it("rejects path traversal in siteName", () => {
      const r = parseWsMessage({ type: "create-site", siteName: "../etc" });
      expect(r.ok).toBe(false);
    });

    it("rejects 101-char siteName", () => {
      const r = parseWsMessage({
        type: "create-site",
        siteName: "a".repeat(101),
      });
      expect(r.ok).toBe(false);
    });

    it("rejects Japanese siteName", () => {
      const r = parseWsMessage({
        type: "create-site",
        siteName: "おしゃれカフェ",
      });
      expect(r.ok).toBe(false);
    });

    it("ignores client-supplied owner field (parses but server overrides)", () => {
      const r = parseWsMessage({
        type: "create-site",
        owner: "attacker",
        siteName: "ok-name",
      });
      expect(r.ok).toBe(true);
      // owner はパースされるがハンドラ側で参照しない
    });
  });

  describe("import-repo", () => {
    it("accepts valid repoName", () => {
      const r = parseWsMessage({ type: "import-repo", repoName: "my-site" });
      expect(r.ok).toBe(true);
    });

    it("rejects repoName with slashes", () => {
      const r = parseWsMessage({
        type: "import-repo",
        repoName: "owner/name",
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("undo / deploy", () => {
    it("accepts undo", () => {
      const r = parseWsMessage({ type: "undo" });
      expect(r.ok).toBe(true);
    });

    it("accepts deploy", () => {
      const r = parseWsMessage({ type: "deploy" });
      expect(r.ok).toBe(true);
    });
  });

  describe("invalid", () => {
    it("rejects unknown type", () => {
      const r = parseWsMessage({ type: "foo" });
      expect(r.ok).toBe(false);
    });

    it("rejects missing type", () => {
      const r = parseWsMessage({ message: "hi" });
      expect(r.ok).toBe(false);
    });

    it("rejects null", () => {
      const r = parseWsMessage(null);
      expect(r.ok).toBe(false);
    });

    it("rejects array", () => {
      const r = parseWsMessage([{ type: "chat", message: "hi" }]);
      expect(r.ok).toBe(false);
    });
  });
});

import { describe, it, expect } from "vitest";
import { parseWsClientMessage } from "./ws-schemas.js";

describe("parseWsClientMessage", () => {
  describe("chat", () => {
    it("最小限のメッセージを受理する", () => {
      const r = parseWsClientMessage({ type: "chat", message: "ヘッダーを青くして" });
      expect(r.ok).toBe(true);
    });

    it("elementContext と imageUrl 付きを受理する", () => {
      const r = parseWsClientMessage({
        type: "chat",
        message: "色を変えて",
        imageUrl: "/uploads/abc.png",
        elementContext: {
          ocId: "x-1",
          tag: "h1",
          componentTree: [{ name: "Header", file: "src/components/Header.tsx" }],
        },
      });
      expect(r.ok).toBe(true);
    });

    it("空メッセージを拒否する", () => {
      const r = parseWsClientMessage({ type: "chat", message: "" });
      expect(r.ok).toBe(false);
    });

    it("8001 文字を拒否する", () => {
      const r = parseWsClientMessage({
        type: "chat",
        message: "a".repeat(8001),
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("revert", () => {
    it("16進ハッシュを受理する", () => {
      const r = parseWsClientMessage({ type: "revert", hash: "abc1234" });
      expect(r.ok).toBe(true);
    });

    it("非16進文字を含むハッシュを拒否する", () => {
      const r = parseWsClientMessage({ type: "revert", hash: "../etc/passwd" });
      expect(r.ok).toBe(false);
    });
  });

  describe("history", () => {
    it("count なしを受理する", () => {
      const r = parseWsClientMessage({ type: "history" });
      expect(r.ok).toBe(true);
    });

    it("count に小数を渡すと拒否する", () => {
      const r = parseWsClientMessage({ type: "history", count: 1.5 });
      expect(r.ok).toBe(false);
    });

    it("count に巨大値を渡すと拒否する", () => {
      const r = parseWsClientMessage({ type: "history", count: 9999 });
      expect(r.ok).toBe(false);
    });
  });

  describe("create-site / import-repo", () => {
    it("正常な slug を受理する", () => {
      expect(
        parseWsClientMessage({
          type: "create-site",
          owner: "hummer98",
          siteName: "cafe-lumiere",
        }).ok
      ).toBe(true);
    });

    it("スラッシュを含む siteName を拒否する", () => {
      const r = parseWsClientMessage({
        type: "create-site",
        owner: "hummer98",
        siteName: "../etc",
      });
      expect(r.ok).toBe(false);
    });

    it("スペースを含む repoName を拒否する", () => {
      const r = parseWsClientMessage({
        type: "import-repo",
        owner: "hummer98",
        repoName: "my repo",
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("不正な type", () => {
    it("未知の type を拒否する", () => {
      const r = parseWsClientMessage({ type: "evil", payload: "x" });
      expect(r.ok).toBe(false);
    });

    it("type が無いオブジェクトを拒否する", () => {
      const r = parseWsClientMessage({ message: "hi" });
      expect(r.ok).toBe(false);
    });

    it("非オブジェクトを拒否する", () => {
      expect(parseWsClientMessage("oops").ok).toBe(false);
      expect(parseWsClientMessage(null).ok).toBe(false);
      expect(parseWsClientMessage(42).ok).toBe(false);
    });
  });
});

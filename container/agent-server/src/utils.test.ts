import { describe, it, expect } from "vitest";
import { truncateForCommit, buildPrompt, detectCommand } from "./utils.js";

// ---------------------------------------------------------------------------
// truncateForCommit
// ---------------------------------------------------------------------------
describe("truncateForCommit", () => {
  it("空文字列 → 'AI edit'", () => {
    expect(truncateForCommit("")).toBe("AI edit");
  });

  it("50文字以下の1行 → そのまま返す", () => {
    expect(truncateForCommit("ヘッダーの色を変更")).toBe("ヘッダーの色を変更");
  });

  it("50文字超 → 先頭47文字 + '...'", () => {
    const long = "a".repeat(60);
    expect(truncateForCommit(long)).toBe("a".repeat(47) + "...");
  });

  it("複数行 → 最初の非空行を使用", () => {
    expect(truncateForCommit("\n\n  Hello world\nSecond line")).toBe(
      "  Hello world"
    );
  });

  it("全空行 → 'AI edit'", () => {
    expect(truncateForCommit("\n\n\n")).toBe("AI edit");
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------
describe("buildPrompt", () => {
  it("メッセージのみ", () => {
    const result = buildPrompt({ message: "ヘッダーを青くして" });
    expect(result).toBe("## ユーザーの指示\nヘッダーを青くして");
  });

  it("elementContext 付き", () => {
    const result = buildPrompt({
      message: "色を変えて",
      elementContext: {
        ocId: "abc-123",
        tag: "div",
        text: "Hello",
        classes: "bg-red-500 p-4",
        componentTree: [
          { name: "Header", file: "src/components/Header.tsx" },
          { name: "App", file: "src/App.tsx" },
        ],
      },
    });
    expect(result).toContain("## 対象要素");
    expect(result).toContain("- ID: abc-123");
    expect(result).toContain("- タグ: div");
    expect(result).toContain('- テキスト: "Hello"');
    expect(result).toContain("- クラス: bg-red-500 p-4");
    expect(result).toContain("- コンポーネント: Header > App");
    expect(result).toContain("- ファイル: src/components/Header.tsx");
    expect(result).toContain("## ユーザーの指示\n色を変えて");
  });

  it("imageUrl 付き", () => {
    const result = buildPrompt({
      message: "この画像を使って",
      imageUrl: "/uploads/test.png",
    });
    expect(result).toContain("## 添付画像");
    expect(result).toContain("- URL: /uploads/test.png");
    expect(result).toContain("この画像をサイトで使用してください。");
    expect(result).toContain("## ユーザーの指示\nこの画像を使って");
  });

  it("elementContext + imageUrl の両方", () => {
    const result = buildPrompt({
      message: "この画像に差し替えて",
      imageUrl: "/uploads/hero.jpg",
      elementContext: {
        ocId: "img-1",
        tag: "img",
      },
    });
    expect(result).toContain("## 対象要素");
    expect(result).toContain("- ID: img-1");
    expect(result).toContain("## 添付画像");
    expect(result).toContain("- URL: /uploads/hero.jpg");
    expect(result).toContain("## ユーザーの指示\nこの画像に差し替えて");
  });

  it("elementContext なし（空オブジェクト）", () => {
    const result = buildPrompt({
      message: "フッターを追加して",
      elementContext: {},
    });
    // 対象要素セクションは ocId がないので含まれない
    expect(result).not.toContain("## 対象要素");
    expect(result).toBe("## ユーザーの指示\nフッターを追加して");
  });
});

// ---------------------------------------------------------------------------
// detectCommand
// ---------------------------------------------------------------------------
describe("detectCommand", () => {
  describe("日本語 undo", () => {
    it.each([
      "元に戻して",
      "戻して",
      "取り消して",
      "やり直して",
      "さっきの変更を元に戻して",
      "さっきの変更を取り消して",
    ])('"%s" → undo', (msg) => {
      expect(detectCommand(msg)).toEqual({ type: "undo" });
    });
  });

  describe("英語 undo", () => {
    it.each(["undo", "Undo"])('"%s" → undo', (msg) => {
      expect(detectCommand(msg)).toEqual({ type: "undo" });
    });
  });

  describe("日本語 deploy", () => {
    it.each(["公開して", "デプロイして", "公開したい", "サイトを公開して"])(
      '"%s" → deploy',
      (msg) => {
        expect(detectCommand(msg)).toEqual({ type: "deploy" });
      }
    );
  });

  describe("英語 deploy", () => {
    it.each(["deploy", "publish", "Deploy"])('"%s" → deploy', (msg) => {
      expect(detectCommand(msg)).toEqual({ type: "deploy" });
    });
  });

  describe("null を返すべきケース", () => {
    it.each([
      "ヘッダーを青くして",
      "元に戻してから赤くして",
      "公開の準備をして",
      "",
    ])('"%s" → null', (msg) => {
      expect(detectCommand(msg)).toBeNull();
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  truncateForCommit,
  buildPrompt,
  detectCommand,
  sanitizeError,
} from "./utils.js";

// ---------------------------------------------------------------------------
// sanitizeError
// ---------------------------------------------------------------------------
describe("sanitizeError", () => {
  it("redacts x-access-token in URL", () => {
    const err = new Error(
      "Command failed: git push https://x-access-token:ghs_abc123@github.com/owner/repo.git HEAD:main"
    );
    expect(sanitizeError(err)).toContain("x-access-token:[REDACTED]@");
    expect(sanitizeError(err)).not.toContain("ghs_abc123");
  });

  it("preserves non-token error text", () => {
    expect(sanitizeError(new Error("ECONNREFUSED 127.0.0.1:5173"))).toContain(
      "ECONNREFUSED"
    );
  });

  it("handles non-Error values (string, undefined, object) without throwing", () => {
    expect(sanitizeError("plain string")).toBe("plain string");
    expect(sanitizeError(undefined)).toBe("undefined");
    // 一般 object は String(obj) → "[object Object]" のためトークン文字列は元々消えるが、
    // toString() が token を露出するケースをカバー
    const objWithToken = {
      toString: () => "x-access-token:foo@github.com/owner/repo",
    };
    expect(sanitizeError(objWithToken)).toContain("[REDACTED]");
    expect(sanitizeError(objWithToken)).not.toContain("foo");
  });

  it("redacts token even when present in stack trace", () => {
    const err = new Error("boom");
    err.stack =
      "Error: boom\n  at git push https://x-access-token:ghs_xyz@github.com/...";
    expect(sanitizeError(err)).not.toContain("ghs_xyz");
  });

  it("handles multiple occurrences in one string", () => {
    const s =
      "a https://x-access-token:T1@github.com/.. b https://x-access-token:T2@github.com/..";
    const out = sanitizeError(s);
    expect(out).not.toContain("T1");
    expect(out).not.toContain("T2");
  });
});

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

  it("imageUrl 付き — multimodal ガイダンス文言を含み、旧 URL 行は含まない", () => {
    const result = buildPrompt({
      message: "この画像を使って",
      imageUrl: "/uploads/test.png",
    });
    expect(result).toContain("## 添付画像");
    expect(result).toContain("read ツールで読む必要はありません");
    expect(result).toContain("public/uploads/");
    expect(result).toContain('<img src="/uploads/test.png"');
    expect(result).toContain("## ユーザーの指示\nこの画像を使って");
    // 旧フォーマット（text-only URL）は撤廃済み
    expect(result).not.toContain("- URL: /uploads/test.png");
    expect(result).not.toContain("この画像をサイトで使用してください。");
  });

  it("elementContext + imageUrl の両方 — 両セクションが独立して出る", () => {
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
    expect(result).toContain("read ツールで読む必要はありません");
    expect(result).toContain('<img src="/uploads/hero.jpg"');
    expect(result).toContain("## ユーザーの指示\nこの画像に差し替えて");
    expect(result).not.toContain("- URL: /uploads/hero.jpg");
  });

  it("imageUrl なし — 添付画像セクションが一切出ない", () => {
    const result = buildPrompt({ message: "ヘッダーを青くして" });
    expect(result).not.toContain("## 添付画像");
    expect(result).not.toContain("read ツールで読む必要はありません");
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

  describe("日本語 create-site", () => {
    it('"カフェのサイトを作って" → create', () => {
      expect(detectCommand("カフェのサイトを作って")).toEqual({
        type: "create",
        siteName: "カフェ",
      });
    });

    it('"photo-studioのサイトを作りたい" → create', () => {
      expect(detectCommand("photo-studioのサイトを作りたい")).toEqual({
        type: "create",
        siteName: "photo-studio",
      });
    });

    it('"サイトを作って" (サイト名なし) → null', () => {
      expect(detectCommand("サイトを作って")).toBeNull();
    });
  });

  describe("日本語 import-repo", () => {
    it('"le-serpentを編集したい" → import', () => {
      expect(detectCommand("le-serpentを編集したい")).toEqual({
        type: "import",
        repoName: "le-serpent",
      });
    });

    it('"cafe-siteを開いて" → import', () => {
      expect(detectCommand("cafe-siteを開いて")).toEqual({
        type: "import",
        repoName: "cafe-site",
      });
    });

    it('"le-serpentを編集して" → import', () => {
      expect(detectCommand("le-serpentを編集して")).toEqual({
        type: "import",
        repoName: "le-serpent",
      });
    });
  });

  describe("help", () => {
    it.each([
      "使い方",
      "ヘルプ",
      "help",
      "?",
      "使い方を教えて",
      "使い方は？",
    ])('"%s" → help', (msg) => {
      expect(detectCommand(msg)).toEqual({ type: "help" });
    });

    it('"ヘルプを表示して" → null（長い文は OpenCode に委ねる）', () => {
      expect(detectCommand("ヘルプを表示して")).toBeNull();
    });
  });

  describe("reset", () => {
    it.each(["リセットして", "初期化して", "reset", "リセット"])(
      '"%s" → reset',
      (msg) => {
        expect(detectCommand(msg)).toEqual({ type: "reset" });
      }
    );
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

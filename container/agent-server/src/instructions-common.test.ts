import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const COMMON_MD = resolve(REPO_ROOT, "container/instructions/common.md");

describe("container/instructions/common.md", () => {
  it("ファイルが存在する", () => {
    expect(existsSync(COMMON_MD)).toBe(true);
  });

  describe("必須キーワードを含む", () => {
    const required = [
      "browser_take_screenshot",
      "browser_console_messages",
      "read_log",
      "375px",
      "1280px",
      "@tailwind",
      "data-oc-id",
      "nano-banana",
      "<h1>",
      "<section>",
      // 部分編集ガイド
      "対象要素",
      // a11y
      "aria-label",
      "コントラスト",
      // SEO
      "og:image",
      "meta name=\"description\"",
    ];

    for (const keyword of required) {
      it(`キーワード "${keyword}" を含む`, () => {
        const content = readFileSync(COMMON_MD, "utf-8");
        expect(content).toContain(keyword);
      });
    }
  });

  it("セマンティックタグ表の全行が保持されている", () => {
    const content = readFileSync(COMMON_MD, "utf-8");
    const tags = ["<h1>", "<p>", "<button>", "<img", "<ul>", "<table>", "<section>"];
    for (const tag of tags) {
      expect(content).toContain(tag);
    }
  });

  it("冒頭にビルダー側編集を促す注釈がある", () => {
    const content = readFileSync(COMMON_MD, "utf-8");
    // ゲスト側のコピーを編集しても上書きされる旨の注釈
    expect(content).toMatch(/ai-web-builder/);
    expect(content).toMatch(/container\/instructions\/common\.md/);
  });
});

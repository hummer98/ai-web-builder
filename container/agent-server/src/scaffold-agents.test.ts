import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SCAFFOLD_AGENTS_MD = resolve(REPO_ROOT, "container/scaffold/AGENTS.md");

describe("container/scaffold/AGENTS.md (ゲスト固有)", () => {
  describe("ゲスト固有キーワードを含む", () => {
    const required = [
      "デザイナー",
      "カフェ",
      "Phase 1",
      "Phase 2",
      "POST /api/contact",
      "「おしゃれにして」",
    ];

    for (const keyword of required) {
      it(`キーワード "${keyword}" を含む`, () => {
        const content = readFileSync(SCAFFOLD_AGENTS_MD, "utf-8");
        expect(content).toContain(keyword);
      });
    }
  });

  describe("共通ルール系キーワードを含まない", () => {
    const forbidden = [
      "browser_screenshot",
      "@tailwind",
      "data-oc-id",
      "nano-banana",
      "375px",
      "最小変更",
    ];

    for (const keyword of forbidden) {
      it(`キーワード "${keyword}" を含まない`, () => {
        const content = readFileSync(SCAFFOLD_AGENTS_MD, "utf-8");
        expect(content).not.toContain(keyword);
      });
    }
  });

  it("共通インストラクションへの言及がある", () => {
    const content = readFileSync(SCAFFOLD_AGENTS_MD, "utf-8");
    // 共通ルールへの参照（重複説明回避のための案内）
    expect(content).toMatch(/共通|instructions/);
  });
});

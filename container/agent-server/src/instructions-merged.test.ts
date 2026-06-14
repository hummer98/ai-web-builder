import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const COMMON_MD = resolve(REPO_ROOT, "container/instructions/common.md");
const SCAFFOLD_AGENTS_MD = resolve(REPO_ROOT, "container/scaffold/AGENTS.md");

describe("scaffold/AGENTS.md + instructions/common.md 結合", () => {
  const REQUIRED_KEYWORDS = [
    // 共通側（MCP 検証）
    "browser_take_screenshot",
    "browser_console_messages",
    "read_log",
    // 共通側（レスポンシブ）
    "375px",
    "1280px",
    // 共通側（禁止事項）
    "@tailwind",
    "data-oc-id",
    "最小変更",
    // 共通側（画像生成）
    "nano-banana",
    "generate_image",
    "public/images/",
    // 共通側（セマンティックタグ）
    "<h1>",
    "<p>",
    "<button>",
    "<section>",
    "<table>",
    "<ul>",
    // 共通側（技術スタック）
    "React 19",
    "Tailwind CSS v4",
    // ゲスト側（デザイナーペルソナ）
    "デザイナー",
    "カフェ",
    // ゲスト側（ワークフロー）
    "計画",
    "実装",
    "検証",
    // ゲスト側（Phase 1/2）
    "Phase 1",
    "Phase 2",
    // ゲスト側（曖昧指示解釈）
    "「おしゃれにして」",
    "「ここを変えて」",
    // ゲスト側（フォーム）
    "POST /api/contact",
  ];

  for (const keyword of REQUIRED_KEYWORDS) {
    it(`結合後に "${keyword}" を含む`, () => {
      const common = readFileSync(COMMON_MD, "utf-8");
      const scaffold = readFileSync(SCAFFOLD_AGENTS_MD, "utf-8");
      const merged = `${common}\n\n${scaffold}`;
      expect(merged).toContain(keyword);
    });
  }
});

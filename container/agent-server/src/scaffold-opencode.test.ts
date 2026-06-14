import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SCAFFOLD_OPENCODE_JSON = resolve(REPO_ROOT, "container/scaffold/opencode.json");

describe("container/scaffold/opencode.json", () => {
  function load() {
    return JSON.parse(readFileSync(SCAFFOLD_OPENCODE_JSON, "utf-8"));
  }

  it("有効な JSON としてパースできる", () => {
    expect(() => load()).not.toThrow();
  });

  it("instructions フィールドが配列として存在する", () => {
    const d = load();
    expect(Array.isArray(d.instructions)).toBe(true);
  });

  it("instructions は空配列（実パスは postprocess が注入）", () => {
    const d = load();
    expect(d.instructions).toEqual([]);
  });

  it("既存の provider フィールドが保持されている", () => {
    const d = load();
    expect(d.provider).toBeDefined();
    expect(d.provider.openrouter).toBeDefined();
  });

  it("provider.openrouter.options.apiKey placeholder は含まれない (BYOK 必須化)", () => {
    const d = load();
    expect(d.provider.openrouter.options?.apiKey).toBeUndefined();
    const raw = readFileSync(SCAFFOLD_OPENCODE_JSON, "utf-8");
    expect(raw).not.toContain("{env:OPENROUTER_API_KEY}");
  });

  it("nano-banana に environment.GEMINI_API_KEY が事前設定されていない", () => {
    const d = load();
    const env = d.mcp?.["nano-banana"]?.environment;
    if (env) {
      expect(env.GEMINI_API_KEY).toBeUndefined();
    }
  });

  it("既存の mcp フィールド（playwright / log-reader / nano-banana）が保持されている", () => {
    const d = load();
    expect(d.mcp).toBeDefined();
    expect(d.mcp.playwright).toBeDefined();
    expect(d.mcp["log-reader"]).toBeDefined();
    expect(d.mcp["nano-banana"]).toBeDefined();
  });

  it("playwright command に無効な --url オプションを渡さない（@playwright/mcp は --url を持たない）", () => {
    // @playwright/mcp の CLI に --url は存在せず、渡すと `error: unknown option '--url'` で
    // 起動失敗し、視覚検証ツール（browser_*）が一切登録されなくなる。
    // 起動 URL は CLI では渡せないため、エージェントが browser_navigate で開く前提。
    const d = load();
    const cmd: string[] = d.mcp.playwright.command;
    expect(cmd).not.toContain("--url");
    expect(cmd.slice(0, 3)).toEqual(["npx", "@playwright/mcp", "--headless"]);
  });

  it("playwright command が --browser chromium を指定する（bundled chromium を使う）", () => {
    // @playwright/mcp のデフォルトは chrome channel (/opt/google/chrome/chrome) を探すが、
    // Dockerfile は `playwright install chromium`（bundled chromium）のみ入れているため
    // chrome 不在で `Chromium distribution 'chrome' is not found` になる。
    // --browser chromium で PLAYWRIGHT_BROWSERS_PATH 配下の bundled chromium を使わせる。
    const d = load();
    const cmd: string[] = d.mcp.playwright.command;
    const i = cmd.indexOf("--browser");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(cmd[i + 1]).toBe("chromium");
  });
});

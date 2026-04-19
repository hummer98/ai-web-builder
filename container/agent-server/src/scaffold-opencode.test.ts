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

  it("既存の mcp フィールド（playwright / log-reader / nano-banana）が保持されている", () => {
    const d = load();
    expect(d.mcp).toBeDefined();
    expect(d.mcp.playwright).toBeDefined();
    expect(d.mcp["log-reader"]).toBeDefined();
    expect(d.mcp["nano-banana"]).toBeDefined();
  });
});

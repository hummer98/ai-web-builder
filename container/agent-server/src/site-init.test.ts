import { describe, it, expect } from "vitest";
import { assertSafeWorkspacePath } from "./site-init.js";

describe("assertSafeWorkspacePath", () => {
  it("通常の絶対パス → そのまま返す", () => {
    expect(assertSafeWorkspacePath("/data/workspace")).toBe("/data/workspace");
  });

  it("ネストしたパス", () => {
    expect(assertSafeWorkspacePath("/data/workspace/site-a")).toBe(
      "/data/workspace/site-a"
    );
  });

  it("相対パスは cwd 基準で絶対化される", () => {
    const result = assertSafeWorkspacePath("./workspace");
    expect(result.startsWith("/")).toBe(true);
    expect(result.endsWith("/workspace")).toBe(true);
  });

  it('空文字 → throw', () => {
    expect(() => assertSafeWorkspacePath("")).toThrow(/unsafe path/);
  });

  it('"/" → throw', () => {
    expect(() => assertSafeWorkspacePath("/")).toThrow(/unsafe path/);
  });

  it("ルートに解決される相対パス → throw", () => {
    // /data/workspace から見た "../../.." のような状況はプロセス起動位置によるが、
    // 明示的に解決して segments が 0 になるケースを検証
    expect(() => assertSafeWorkspacePath("/..")).toThrow(/root/);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

type SiteInit = typeof import("./site-init.js");

let tmpDir: string;
let siteInit: SiteInit;

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const EXPECTED_COMMON_MD_ABS = resolve(REPO_ROOT, "container/instructions/common.md");

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "site-init-test-"));
  vi.stubEnv("WORKSPACE_DIR", tmpDir);
  vi.resetModules();
  siteInit = await import("./site-init.js");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("postprocessWorkspaceOpencodeJson", () => {
  it("共通 md の絶対パスを instructions に注入する", () => {
    const opencodeJsonPath = join(tmpDir, "opencode.json");
    writeFileSync(
      opencodeJsonPath,
      JSON.stringify({ instructions: [], mcp: {} }, null, 2)
    );
    siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
    const d = JSON.parse(readFileSync(opencodeJsonPath, "utf-8"));
    expect(d.instructions).toContain(EXPECTED_COMMON_MD_ABS);
  });

  it("絶対パスは import.meta.dirname 基準で解決され cwd に依存しない", () => {
    const opencodeJsonPath = join(tmpDir, "opencode.json");
    writeFileSync(
      opencodeJsonPath,
      JSON.stringify({ instructions: [] }, null, 2)
    );
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
      const d = JSON.parse(readFileSync(opencodeJsonPath, "utf-8"));
      expect(d.instructions).toContain(EXPECTED_COMMON_MD_ABS);
      // 念のため cwd 相対パスが混入していないことを確認
      for (const p of d.instructions) {
        expect(p.startsWith("./") || p.startsWith("../")).toBe(false);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("GEMINI_API_KEY が設定されていれば nano-banana 環境変数も注入される", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-site-init-key");
    const opencodeJsonPath = join(tmpDir, "opencode.json");
    writeFileSync(
      opencodeJsonPath,
      JSON.stringify(
        {
          instructions: [],
          mcp: {
            "nano-banana": { type: "local", command: ["npx", "nano-banana-mcp"] },
          },
        },
        null,
        2
      )
    );
    siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
    const d = JSON.parse(readFileSync(opencodeJsonPath, "utf-8"));
    expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBe("test-site-init-key");
  });

  it("2 回呼び出しても idempotent（instructions が肥大化しない）", () => {
    const opencodeJsonPath = join(tmpDir, "opencode.json");
    writeFileSync(
      opencodeJsonPath,
      JSON.stringify({ instructions: [] }, null, 2)
    );
    siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
    siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
    const d = JSON.parse(readFileSync(opencodeJsonPath, "utf-8"));
    const common = d.instructions.filter((p: string) => p === EXPECTED_COMMON_MD_ABS);
    expect(common).toHaveLength(1);
  });
});

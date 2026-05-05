import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

type SiteInit = typeof import("./site-init.js");

let tmpDir: string;
let secretsPath: string;
let siteInit: SiteInit;

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const EXPECTED_COMMON_MD_ABS = resolve(REPO_ROOT, "container/instructions/common.md");

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "site-init-test-"));
  secretsPath = join(tmpDir, "secrets.json");
  vi.stubEnv("WORKSPACE_DIR", tmpDir);
  vi.stubEnv("SECRETS_FILE", secretsPath);
  // 旧 env 経路を確実に塞ぐ: GEMINI_API_KEY が残っていても無視されるべき
  vi.stubEnv("GEMINI_API_KEY", "GEMINI_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG");
  vi.stubEnv("OPENROUTER_API_KEY", "OPENROUTER_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG");
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
      for (const p of d.instructions) {
        expect(p.startsWith("./") || p.startsWith("../")).toBe(false);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("secrets.json に gemini.apiKey があれば nano-banana 環境変数に注入される", () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({ gemini: { apiKey: "BYOK_GEMINI_CANARY_DO_NOT_LOG" } })
    );
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
    expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBe(
      "BYOK_GEMINI_CANARY_DO_NOT_LOG"
    );
  });

  it("secrets.json に openrouter.apiKey があれば provider.openrouter.options.apiKey に注入される", () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({ openrouter: { apiKey: "BYOK_OR_CANARY_DO_NOT_LOG" } })
    );
    const opencodeJsonPath = join(tmpDir, "opencode.json");
    writeFileSync(
      opencodeJsonPath,
      JSON.stringify(
        {
          instructions: [],
          provider: {
            openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } },
          },
        },
        null,
        2
      )
    );
    siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
    const d = JSON.parse(readFileSync(opencodeJsonPath, "utf-8"));
    expect(d.provider.openrouter.options.apiKey).toBe(
      "BYOK_OR_CANARY_DO_NOT_LOG"
    );
  });

  it("secrets.json が空 (ファイル不在) なら apiKey は削除される (env fallback しない)", () => {
    const opencodeJsonPath = join(tmpDir, "opencode.json");
    writeFileSync(
      opencodeJsonPath,
      JSON.stringify(
        {
          instructions: [],
          provider: {
            openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } },
          },
          mcp: {
            "nano-banana": {
              type: "local",
              command: ["npx"],
              environment: { GEMINI_API_KEY: "leftover" },
            },
          },
        },
        null,
        2
      )
    );
    siteInit.postprocessWorkspaceOpencodeJson(tmpDir);
    const fileContent = readFileSync(opencodeJsonPath, "utf-8");
    const d = JSON.parse(fileContent);
    expect(d.provider.openrouter.options.apiKey).toBeUndefined();
    expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBeUndefined();
    // 環境変数の decoy が漏れていないことを確認
    expect(fileContent).not.toContain(
      "OPENROUTER_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG"
    );
    expect(fileContent).not.toContain(
      "GEMINI_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG"
    );
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

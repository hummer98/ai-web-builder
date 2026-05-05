import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const POSTPROCESS_MODULE = resolve(REPO_ROOT, "container/opencode-postprocess.mjs");
const POSTPROCESS_SCRIPT = POSTPROCESS_MODULE;
const COMMON_MD_FOR_CLI = resolve(REPO_ROOT, "container/instructions/common.md");

type Postprocess = typeof import("../../opencode-postprocess.mjs");

let tmpDir: string;
let jsonPath: string;
let mod: Postprocess;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "opencode-postprocess-"));
  jsonPath = join(tmpDir, "opencode.json");
  mod = await import(POSTPROCESS_MODULE);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("postprocessOpencodeJson", () => {
  it("空の instructions に絶対パスを 1 件注入する", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify({ instructions: [], mcp: {} }, null, 2)
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toEqual(["/app/container/instructions/common.md"]);
  });

  it("instructions フィールドが存在しない場合も新規作成して注入する", () => {
    writeFileSync(jsonPath, JSON.stringify({ mcp: {} }, null, 2));
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toEqual(["/app/container/instructions/common.md"]);
  });

  it("idempotency: 既に同じ絶対パスがあれば重複追加しない", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          instructions: ["/app/container/instructions/common.md"],
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toEqual(["/app/container/instructions/common.md"]);
  });

  it("scaffold 由来の相対パス（common.md を指す）を除去してから絶対パスを push する", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          instructions: [
            "../container/instructions/common.md",
            "./container/instructions/common.md",
          ],
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toEqual(["/app/container/instructions/common.md"]);
  });

  it("common.md 以外の instructions エントリは保持される", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          instructions: ["./docs/other.md", "./team/style.md"],
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toContain("/app/container/instructions/common.md");
    expect(d.instructions).toContain("./docs/other.md");
    expect(d.instructions).toContain("./team/style.md");
  });

  it("nano-banana の環境変数を注入しても他フィールドを壊さない", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          instructions: [],
          mcp: {
            "nano-banana": {
              type: "local",
              command: ["npx", "nano-banana-mcp"],
            },
            playwright: {
              type: "local",
              command: ["npx", "@playwright/mcp"],
            },
          },
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
      nanoBananaApiKey: "test-key-xyz",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.mcp["nano-banana"].environment).toEqual({
      GEMINI_API_KEY: "test-key-xyz",
    });
    expect(d.mcp["nano-banana"].command).toEqual(["npx", "nano-banana-mcp"]);
    expect(d.mcp.playwright).toBeDefined();
    expect(d.instructions).toEqual(["/app/container/instructions/common.md"]);
  });

  it("既存の nano-banana.environment を保持しつつ GEMINI_API_KEY を追加する", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          mcp: {
            "nano-banana": {
              type: "local",
              command: ["npx", "nano-banana-mcp"],
              environment: {
                FOO: "bar",
              },
            },
          },
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
      nanoBananaApiKey: "new-key",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.mcp["nano-banana"].environment).toEqual({
      FOO: "bar",
      GEMINI_API_KEY: "new-key",
    });
  });

  it("nanoBananaApiKey が未指定なら environment を触らない", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          mcp: {
            "nano-banana": {
              type: "local",
              command: ["npx"],
              environment: { FOO: "bar" },
            },
          },
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.mcp["nano-banana"].environment).toEqual({ FOO: "bar" });
  });

  it("対象ファイルが存在しない場合はエラーを投げる", () => {
    expect(() =>
      mod.postprocessOpencodeJson(join(tmpDir, "does-not-exist.json"), {
        commonMdAbsPath: "/app/container/instructions/common.md",
      })
    ).toThrow();
  });

  it("mcp['nano-banana'] が存在しない場合は silently スキップ", () => {
    writeFileSync(jsonPath, JSON.stringify({ mcp: {} }, null, 2));
    expect(() =>
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
        nanoBananaApiKey: "x",
      })
    ).not.toThrow();
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.mcp["nano-banana"]).toBeUndefined();
  });

  it("siteBriefAbsPath を渡すと instructions に追加される", () => {
    writeFileSync(jsonPath, JSON.stringify({ instructions: [] }, null, 2));
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
      siteBriefAbsPath: "/data/workspace/SITE_BRIEF.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toEqual([
      "/app/container/instructions/common.md",
      "/data/workspace/SITE_BRIEF.md",
    ]);
  });

  it("scaffold 由来の SITE_BRIEF.md 相対パスを除去してから絶対パスを push する", () => {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          instructions: ["./SITE_BRIEF.md"],
        },
        null,
        2
      )
    );
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
      siteBriefAbsPath: "/data/workspace/SITE_BRIEF.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).not.toContain("./SITE_BRIEF.md");
    expect(d.instructions).toContain("/data/workspace/SITE_BRIEF.md");
  });

  it("siteBriefAbsPath 未指定なら instructions に追加されない (idempotent)", () => {
    writeFileSync(jsonPath, JSON.stringify({ instructions: [] }, null, 2));
    mod.postprocessOpencodeJson(jsonPath, {
      commonMdAbsPath: "/app/container/instructions/common.md",
    });
    const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(d.instructions).toEqual(["/app/container/instructions/common.md"]);
  });

  it("commonMdAbsPath 未指定時はエラーを投げる", () => {
    writeFileSync(jsonPath, JSON.stringify({}, null, 2));
    expect(() =>
      // @ts-expect-error - intentionally missing required field
      mod.postprocessOpencodeJson(jsonPath, {})
    ).toThrow();
  });

  describe("openrouter apiKey", () => {
    it("openrouterApiKey を渡すと provider.openrouter.options.apiKey に実値が書き込まれる", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            provider: {
              openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } },
            },
          },
          null,
          2
        )
      );
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
        openrouterApiKey: "BYOK_OR_CANARY_DO_NOT_LOG",
      });
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.provider.openrouter.options.apiKey).toBe(
        "BYOK_OR_CANARY_DO_NOT_LOG"
      );
    });

    it("openrouterApiKey 未指定で既存の placeholder apiKey は削除される", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            provider: {
              openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } },
            },
          },
          null,
          2
        )
      );
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
      });
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.provider.openrouter.options.apiKey).toBeUndefined();
    });

    it("openrouterApiKey が空文字でも apiKey は削除される", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            provider: {
              openrouter: { options: { apiKey: "old-value" } },
            },
          },
          null,
          2
        )
      );
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
        openrouterApiKey: "",
      });
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.provider.openrouter.options.apiKey).toBeUndefined();
    });

    it("provider.openrouter.options が空オブジェクトでも壊れない", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          { provider: { openrouter: { options: {} } } },
          null,
          2
        )
      );
      expect(() =>
        mod.postprocessOpencodeJson(jsonPath, {
          commonMdAbsPath: "/app/container/instructions/common.md",
        })
      ).not.toThrow();
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.provider.openrouter.options).toEqual({});
    });

    it("provider.openrouter が無くても壊れない", () => {
      writeFileSync(jsonPath, JSON.stringify({ provider: {} }, null, 2));
      expect(() =>
        mod.postprocessOpencodeJson(jsonPath, {
          commonMdAbsPath: "/app/container/instructions/common.md",
          openrouterApiKey: "BYOK_OR_CANARY_DO_NOT_LOG",
        })
      ).not.toThrow();
    });
  });

  describe("--from-secrets CLI", () => {
    it("SECRETS_FILE 経由で openrouter / gemini の apiKey が opencode.json に書き込まれる", () => {
      const secretsPath = join(tmpDir, "secrets.json");
      writeFileSync(
        secretsPath,
        JSON.stringify({
          openrouter: { apiKey: "BYOK_OR_CANARY_DO_NOT_LOG" },
          gemini: { apiKey: "BYOK_GEMINI_CANARY_DO_NOT_LOG" },
        })
      );
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            provider: { openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } } },
            mcp: {
              "nano-banana": { type: "local", command: ["npx"] },
            },
          },
          null,
          2
        )
      );
      execFileSync(
        "node",
        [
          POSTPROCESS_SCRIPT,
          jsonPath,
          `--common=${COMMON_MD_FOR_CLI}`,
          "--from-secrets",
        ],
        {
          env: {
            ...process.env,
            // ホスト側の env キー混入を防ぐため、テストでは明示的に空にする
            SECRETS_FILE: secretsPath,
            OPENROUTER_API_KEY: "",
            GEMINI_API_KEY: "",
          },
          encoding: "utf-8",
        }
      );
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.provider.openrouter.options.apiKey).toBe(
        "BYOK_OR_CANARY_DO_NOT_LOG"
      );
      expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBe(
        "BYOK_GEMINI_CANARY_DO_NOT_LOG"
      );
    });

    it("--from-secrets 指定で secrets.json が無い場合、apiKey フィールドは削除される（env fallback しない）", () => {
      const missingSecretsPath = join(tmpDir, "no-secrets.json");
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            provider: { openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } } },
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
      execFileSync(
        "node",
        [
          POSTPROCESS_SCRIPT,
          jsonPath,
          `--common=${COMMON_MD_FOR_CLI}`,
          "--from-secrets",
        ],
        {
          env: {
            ...process.env,
            SECRETS_FILE: missingSecretsPath,
            OPENROUTER_API_KEY: "OPENROUTER_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG",
            GEMINI_API_KEY: "GEMINI_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG",
          },
          encoding: "utf-8",
        }
      );
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.provider.openrouter.options.apiKey).toBeUndefined();
      expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBeUndefined();
      const fileContent = readFileSync(jsonPath, "utf-8");
      expect(fileContent).not.toContain("OPENROUTER_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG");
      expect(fileContent).not.toContain("GEMINI_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG");
    });
  });

  describe("gemini / nano-banana alias", () => {
    it("geminiApiKey を渡しても nanoBananaApiKey と同等に動作（alias）", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            mcp: {
              "nano-banana": {
                type: "local",
                command: ["npx", "nano-banana-mcp"],
              },
            },
          },
          null,
          2
        )
      );
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
        geminiApiKey: "BYOK_GEMINI_CANARY_DO_NOT_LOG",
      });
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBe(
        "BYOK_GEMINI_CANARY_DO_NOT_LOG"
      );
    });

    it("geminiApiKey 未指定で既存 GEMINI_API_KEY は削除される（他 env キーは保持）", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            mcp: {
              "nano-banana": {
                type: "local",
                command: ["npx"],
                environment: { GEMINI_API_KEY: "old-key", FOO: "bar" },
              },
            },
          },
          null,
          2
        )
      );
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
      });
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBeUndefined();
      expect(d.mcp["nano-banana"].environment.FOO).toBe("bar");
    });

    it("geminiApiKey と nanoBananaApiKey 両方指定なら geminiApiKey が優先される", () => {
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            mcp: {
              "nano-banana": { type: "local", command: ["npx"] },
            },
          },
          null,
          2
        )
      );
      mod.postprocessOpencodeJson(jsonPath, {
        commonMdAbsPath: "/app/container/instructions/common.md",
        geminiApiKey: "from-gemini",
        nanoBananaApiKey: "from-nano",
      });
      const d = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(d.mcp["nano-banana"].environment.GEMINI_API_KEY).toBe("from-gemini");
    });
  });
});

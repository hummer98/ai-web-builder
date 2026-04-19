import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const POSTPROCESS_MODULE = resolve(REPO_ROOT, "container/opencode-postprocess.mjs");

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

  it("commonMdAbsPath 未指定時はエラーを投げる", () => {
    writeFileSync(jsonPath, JSON.stringify({}, null, 2));
    expect(() =>
      // @ts-expect-error - intentionally missing required field
      mod.postprocessOpencodeJson(jsonPath, {})
    ).toThrow();
  });
});

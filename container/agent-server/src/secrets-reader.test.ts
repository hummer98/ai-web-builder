import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const READER_MODULE = resolve(REPO_ROOT, "container/secrets-reader.mjs");

type Reader = typeof import("../../secrets-reader.mjs");

let tmpDir: string;
let secretsPath: string;
let reader: Reader;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "secrets-reader-test-"));
  secretsPath = join(tmpDir, "secrets.json");
  vi.stubEnv("SECRETS_FILE", secretsPath);
  reader = await import(READER_MODULE);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("resolveSecretsPath", () => {
  it("SECRETS_FILE env が設定されていればその値を返す", () => {
    expect(reader.resolveSecretsPath()).toBe(secretsPath);
  });
});

describe("loadOpencodeRelevantSecrets", () => {
  it("ファイルが存在しなければ {} を返す", () => {
    expect(reader.loadOpencodeRelevantSecrets()).toEqual({});
  });

  it("不正な JSON でも throw せず {} を返す", () => {
    writeFileSync(secretsPath, "not json {{{", "utf-8");
    expect(reader.loadOpencodeRelevantSecrets()).toEqual({});
  });

  it("openrouter.apiKey のみあれば {openrouterApiKey} を返す", () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({ openrouter: { apiKey: "BYOK_OR_CANARY_DO_NOT_LOG" } }),
      "utf-8"
    );
    expect(reader.loadOpencodeRelevantSecrets()).toEqual({
      openrouterApiKey: "BYOK_OR_CANARY_DO_NOT_LOG",
    });
  });

  it("openrouter / gemini 両方があれば両方を返す", () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({
        openrouter: { apiKey: "BYOK_OR_CANARY_DO_NOT_LOG" },
        gemini: { apiKey: "BYOK_GEMINI_CANARY_DO_NOT_LOG" },
      }),
      "utf-8"
    );
    expect(reader.loadOpencodeRelevantSecrets()).toEqual({
      openrouterApiKey: "BYOK_OR_CANARY_DO_NOT_LOG",
      geminiApiKey: "BYOK_GEMINI_CANARY_DO_NOT_LOG",
    });
  });

  it("cloudflare / firebase は無視される", () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({
        openrouter: { apiKey: "BYOK_OR_CANARY_DO_NOT_LOG" },
        cloudflare: { apiToken: "cf-tok", accountId: "cf-id" },
        firebase: { token: "fb-tok" },
      }),
      "utf-8"
    );
    const result = reader.loadOpencodeRelevantSecrets();
    expect(result).toEqual({
      openrouterApiKey: "BYOK_OR_CANARY_DO_NOT_LOG",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("cf-tok");
    expect(serialized).not.toContain("fb-tok");
  });

  it("空オブジェクトの secrets では {} を返す", () => {
    writeFileSync(secretsPath, JSON.stringify({}), "utf-8");
    expect(reader.loadOpencodeRelevantSecrets()).toEqual({});
  });

  it("apiKey が空文字列の場合は無視される", () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({
        openrouter: { apiKey: "" },
        gemini: { apiKey: "" },
      }),
      "utf-8"
    );
    expect(reader.loadOpencodeRelevantSecrets()).toEqual({});
  });
});

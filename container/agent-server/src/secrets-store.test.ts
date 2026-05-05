import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  statSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Store = typeof import("./secrets-store.js");

let tmpDir: string;
let secretsPath: string;
let store: Store;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "secrets-store-test-"));
  secretsPath = join(tmpDir, "secrets.json");
  vi.stubEnv("SECRETS_FILE", secretsPath);
  vi.resetModules();
  store = await import("./secrets-store.js");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("secrets-store", () => {
  it("loadSecrets returns {} when file does not exist", () => {
    expect(store.loadSecrets()).toEqual({});
    expect(existsSync(secretsPath)).toBe(false);
  });

  it("saveSecrets and loadSecrets round-trip", () => {
    const input = {
      openrouter: { apiKey: "sk-or-test-1234" },
      cloudflare: { apiToken: "tok-abcd", accountId: "acct-xyz" },
    };
    store.saveSecrets(input);
    expect(store.loadSecrets()).toEqual(input);
  });

  it("saveSecrets sets file permission to 0600", () => {
    store.saveSecrets({ openrouter: { apiKey: "sk-or-test" } });
    const mode = statSync(secretsPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("updateProvider with null deletes the provider entry", () => {
    store.saveSecrets({
      openrouter: { apiKey: "sk-or-1111" },
      gemini: { apiKey: "gem-2222" },
    });
    store.updateProvider("openrouter", null);
    const loaded = store.loadSecrets();
    expect(loaded.openrouter).toBeUndefined();
    expect(loaded.gemini).toEqual({ apiKey: "gem-2222" });
  });

  it("getStatus returns last4 only and never the secret body", () => {
    store.saveSecrets({
      openrouter: { apiKey: "sk-or-AAAAAAAA1234" },
      cloudflare: { apiToken: "tok-abcdef9999", accountId: "ACCT-PUBLIC" },
    });
    const s = store.getStatus();
    expect(s.openrouter.set).toBe(true);
    expect(s.openrouter.last4).toBe("1234");
    expect(s.cloudflare.set).toBe(true);
    expect(s.cloudflare.last4).toBe("9999");
    expect(s.cloudflare.accountId).toBe("ACCT-PUBLIC");
    expect(s.gemini.set).toBe(false);
    expect(s.firebase.set).toBe(false);

    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain("sk-or-AAAAAAAA1234");
    expect(serialized).not.toContain("tok-abcdef9999");
  });

  it("loadSecrets does not throw on corrupt JSON file", () => {
    writeFileSync(secretsPath, "not a json {{{", "utf-8");
    expect(() => store.loadSecrets()).not.toThrow();
    expect(store.loadSecrets()).toEqual({});
  });

  it("atomic write: tmp file is consumed and main file stays correct", () => {
    store.saveSecrets({ openrouter: { apiKey: "sk-or-first" } });
    expect(existsSync(secretsPath)).toBe(true);

    const tmpPath = secretsPath + ".tmp";
    writeFileSync(tmpPath, "garbage leftover", "utf-8");
    expect(existsSync(tmpPath)).toBe(true);

    store.saveSecrets({ openrouter: { apiKey: "sk-or-second" } });

    expect(existsSync(tmpPath)).toBe(false);
    const loaded = JSON.parse(readFileSync(secretsPath, "utf-8"));
    expect(loaded).toEqual({ openrouter: { apiKey: "sk-or-second" } });
    const mode = statSync(secretsPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

describe("detectProvider", () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "deploy-detect-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("wrangler.toml のみなら cloudflare", async () => {
    writeFileSync(join(tmp, "wrangler.toml"), "name = 'site'\n");
    const { detectProvider } = await import("./deploy.js");
    expect(detectProvider(tmp)).toEqual({ ok: true, provider: "cloudflare" });
  });

  it("firebase.json のみなら firebase", async () => {
    writeFileSync(join(tmp, "firebase.json"), "{}");
    const { detectProvider } = await import("./deploy.js");
    expect(detectProvider(tmp)).toEqual({ ok: true, provider: "firebase" });
  });

  it("両方あるとエラー", async () => {
    writeFileSync(join(tmp, "wrangler.toml"), "name = 'site'\n");
    writeFileSync(join(tmp, "firebase.json"), "{}");
    const { detectProvider } = await import("./deploy.js");
    const result = detectProvider(tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("両方");
  });

  it("どちらも無いとエラー", async () => {
    const { detectProvider } = await import("./deploy.js");
    const result = detectProvider(tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("見つかりません");
  });
});

describe("deploy", () => {
  let calls: { cmd: string; args: string[] }[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "deploy-run-"));
    calls = [];
    vi.stubEnv("WORKSPACE_DIR", tmp);
    vi.resetModules();

    // execFileSync をモック化して、実コマンドは走らせず引数だけ記録する
    vi.doMock("node:child_process", () => ({
      execFileSync: vi.fn((cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        if (args[0] === "wrangler" && args[1] === "pages") {
          return "Deployed to https://example.pages.dev\n";
        }
        if (args[0] === "firebase") {
          return "Hosting URL: https://le-serpent.web.app\n";
        }
        return "";
      }),
    }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("cloudflare 経路: vite build → wrangler pages deploy → wrangler deploy を順に呼び url を返す", async () => {
    writeFileSync(join(tmp, "wrangler.toml"), "name = 'site'\n");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "tok");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("example");

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.pages.dev");

    expect(calls.map((c) => c.args.slice(0, 3))).toEqual([
      ["vite", "build"],
      ["wrangler", "pages", "deploy"],
      ["wrangler", "deploy", "functions/api/index.ts"],
    ]);
  });

  it("firebase 経路: vite build → firebase deploy を呼び Hosting URL を返す", async () => {
    writeFileSync(join(tmp, "firebase.json"), "{}");
    vi.stubEnv("FIREBASE_TOKEN", "1//0e-fake-refresh-token");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://le-serpent.web.app");

    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      ["vite", "build"],
      ["firebase", "deploy"],
    ]);
    // --token を CLI 引数に出していない（ps から漏れない）
    const firebaseCall = calls.find((c) => c.args[0] === "firebase");
    expect(firebaseCall?.args).not.toContain("--token");
  });

  it("firebase 経路: FIREBASE_TOKEN が無いと build も走らせずエラーを返す", async () => {
    writeFileSync(join(tmp, "firebase.json"), "{}");
    vi.stubEnv("FIREBASE_TOKEN", "");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("FIREBASE_TOKEN");
    // 早期リターンで vite build も firebase deploy も呼ばれない
    expect(calls).toHaveLength(0);
  });

  it("設定ファイルが無いと vite build も走らずエラーを返す", async () => {
    const { deploy } = await import("./deploy.js");
    const result = await deploy("nowhere");

    expect(result.success).toBe(false);
    expect(result.error).toContain("見つかりません");
    expect(calls).toHaveLength(0);
  });

  it("両方の設定ファイルがあるとエラーを返す", async () => {
    writeFileSync(join(tmp, "wrangler.toml"), "name = 'site'\n");
    writeFileSync(join(tmp, "firebase.json"), "{}");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("conflicted");

    expect(result.success).toBe(false);
    expect(result.error).toContain("両方");
    expect(calls).toHaveLength(0);
  });

  it("firebase 経路: functions が array + package.json あり → npm install --prefix が混入する", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({
        hosting: { public: "dist" },
        functions: [{ source: "functions", codebase: "default" }],
      }),
    );
    mkdirSync(join(tmp, "functions"));
    writeFileSync(join(tmp, "functions/package.json"), "{}");
    vi.stubEnv("FIREBASE_TOKEN", "1//0e-fake-refresh-token");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(true);
    // vite build → npm install --prefix functions → firebase deploy の順
    expect(calls.map((c) => [c.cmd, ...c.args.slice(0, 3)])).toEqual([
      ["npx", "vite", "build"],
      ["npm", "install", "--prefix", "functions"],
      ["npx", "firebase", "deploy", "--non-interactive"],
    ]);
  });

  it("firebase 経路: functions が object + package.json あり → npm install --prefix が混入する", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({
        hosting: { public: "dist" },
        functions: { source: "functions" },
      }),
    );
    mkdirSync(join(tmp, "functions"));
    writeFileSync(join(tmp, "functions/package.json"), "{}");
    vi.stubEnv("FIREBASE_TOKEN", "1//0e-fake-refresh-token");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(true);
    expect(calls.map((c) => [c.cmd, ...c.args.slice(0, 3)])).toEqual([
      ["npx", "vite", "build"],
      ["npm", "install", "--prefix", "functions"],
      ["npx", "firebase", "deploy", "--non-interactive"],
    ]);
  });

  it("firebase 経路: functions 未定義 (hosting のみ) → npm install は呼ばれない", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }),
    );
    vi.stubEnv("FIREBASE_TOKEN", "1//0e-fake-refresh-token");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(true);
    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      ["vite", "build"],
      ["firebase", "deploy"],
    ]);
  });

  it("firebase 経路: functions 定義あり + <source>/package.json 不在 → npm install スキップ", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({
        hosting: { public: "dist" },
        functions: { source: "functions" },
      }),
    );
    // functions ディレクトリ / package.json は作らない
    vi.stubEnv("FIREBASE_TOKEN", "1//0e-fake-refresh-token");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(true);
    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      ["vite", "build"],
      ["firebase", "deploy"],
    ]);
  });

  it("firebase 経路: functions array 複数 codebase → 各 source に npm install。同一 source は dedup", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({
        hosting: { public: "dist" },
        functions: [
          { source: "functions", codebase: "default" },
          { source: "billing", codebase: "billing" },
          { source: "functions", codebase: "duplicate" },
        ],
      }),
    );
    mkdirSync(join(tmp, "functions"));
    writeFileSync(join(tmp, "functions/package.json"), "{}");
    mkdirSync(join(tmp, "billing"));
    writeFileSync(join(tmp, "billing/package.json"), "{}");
    vi.stubEnv("FIREBASE_TOKEN", "1//0e-fake-refresh-token");

    const { deploy } = await import("./deploy.js");
    const result = await deploy("le-serpent");

    expect(result.success).toBe(true);
    const npmInstalls = calls.filter(
      (c) => c.cmd === "npm" && c.args[0] === "install",
    );
    expect(npmInstalls).toHaveLength(2);
    expect(npmInstalls.map((c) => c.args[2]).sort()).toEqual([
      "billing",
      "functions",
    ]);
  });
});

describe("readFunctionsSources", () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "deploy-fns-"));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it("array 形式 → source 一覧を返す", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({
        functions: [{ source: "functions" }, { source: "billing" }],
      }),
    );
    const { readFunctionsSources } = await import("./deploy.js");
    expect(readFunctionsSources(tmp)).toEqual(["functions", "billing"]);
  });

  it("object 形式 → 単一 source を返す", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({ functions: { source: "functions" } }),
    );
    const { readFunctionsSources } = await import("./deploy.js");
    expect(readFunctionsSources(tmp)).toEqual(["functions"]);
  });

  it("functions キー無し → 空配列", async () => {
    writeFileSync(join(tmp, "firebase.json"), "{}");
    const { readFunctionsSources } = await import("./deploy.js");
    expect(readFunctionsSources(tmp)).toEqual([]);
  });

  it("壊れた JSON → 空配列", async () => {
    writeFileSync(join(tmp, "firebase.json"), "{not valid json");
    const { readFunctionsSources } = await import("./deploy.js");
    expect(readFunctionsSources(tmp)).toEqual([]);
  });

  it("source 省略時は 'functions' をデフォルト + 同一 source は dedup", async () => {
    writeFileSync(
      join(tmp, "firebase.json"),
      JSON.stringify({
        functions: [{}, { source: "billing" }, { source: "functions" }],
      }),
    );
    const { readFunctionsSources } = await import("./deploy.js");
    expect(readFunctionsSources(tmp)).toEqual(["functions", "billing"]);
  });

  it("firebase.json 自体が無い → 空配列", async () => {
    const { readFunctionsSources } = await import("./deploy.js");
    expect(readFunctionsSources(tmp)).toEqual([]);
  });
});

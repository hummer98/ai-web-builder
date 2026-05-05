import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { loadSecrets } from "./secrets-store.js";
import { sanitizeError } from "./utils.js";

const log = createLogger("deploy");

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";

export type DeployResult = {
  success: boolean;
  url?: string;
  error?: string;
};

export type Provider = "cloudflare" | "firebase";

export type DetectResult =
  | { ok: true; provider: Provider }
  | { ok: false; error: string };

/**
 * ワークスペース直下の設定ファイルからデプロイ先を判定する。
 *   - wrangler.toml のみ → cloudflare
 *   - firebase.json のみ → firebase
 *   - 両方 / どちらも無い → エラー
 */
export function detectProvider(workspaceDir: string): DetectResult {
  const hasFirebase = existsSync(join(workspaceDir, "firebase.json"));
  const hasWrangler = existsSync(join(workspaceDir, "wrangler.toml"));
  if (hasFirebase && hasWrangler) {
    return {
      ok: false,
      error:
        "firebase.json と wrangler.toml が両方あります。デプロイ先を1つに絞ってください",
    };
  }
  if (hasFirebase) return { ok: true, provider: "firebase" };
  if (hasWrangler) return { ok: true, provider: "cloudflare" };
  return {
    ok: false,
    error:
      "firebase.json も wrangler.toml も見つかりません。デプロイ設定が必要です",
  };
}

function run(cmd: string, args: string[]): string {
  log.info(`Running: ${cmd} ${args.join(" ")}`);
  const secrets = loadSecrets();
  const env: NodeJS.ProcessEnv = { ...process.env };
  // BYOK: secretsStore に登録された値だけを子プロセスに渡す。
  // 未設定なら host env から漏れないよう削除する。
  if (secrets.cloudflare) {
    env.CLOUDFLARE_API_TOKEN = secrets.cloudflare.apiToken;
    env.CLOUDFLARE_ACCOUNT_ID = secrets.cloudflare.accountId;
  } else {
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
  }
  if (secrets.firebase) {
    env.FIREBASE_TOKEN = secrets.firebase.token;
  } else {
    delete env.FIREBASE_TOKEN;
  }
  return execFileSync(cmd, args, {
    cwd: WORKSPACE_DIR,
    encoding: "utf-8",
    timeout: 120000,
    env,
  }).trim();
}

async function deployCloudflare(siteName: string): Promise<DeployResult> {
  log.info("Deploying to Cloudflare Pages...", { siteName });
  const pagesOutput = run("npx", [
    "wrangler",
    "pages",
    "deploy",
    "dist",
    "--project-name",
    siteName,
  ]);
  log.info("Pages deployed", { output: pagesOutput.slice(-200) });

  log.info("Deploying to Cloudflare Workers...", { siteName });
  run("npx", [
    "wrangler",
    "deploy",
    "functions/api/index.ts",
    "--name",
    `${siteName}-api`,
  ]);
  log.info("Workers deployed", { siteName });

  const urlMatch = pagesOutput.match(/https:\/\/[^\s]+\.pages\.dev/);
  return { success: true, url: urlMatch?.[0] };
}

type FunctionsConfigEntry = { source?: string };

/**
 * firebase.json から functions の source 一覧を取り出す。
 * array / object / 未定義 / 壊れた JSON を吸収し、同一 source は dedup する。
 */
export function readFunctionsSources(workspaceDir: string): string[] {
  const path = join(workspaceDir, "firebase.json");
  if (!existsSync(path)) return [];
  let parsed: { functions?: FunctionsConfigEntry | FunctionsConfigEntry[] };
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
  const fns = parsed.functions;
  if (!fns) return [];
  const list = Array.isArray(fns) ? fns : [fns];
  return list
    .map((e) => e.source ?? "functions")
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

async function deployFirebase(siteName: string): Promise<DeployResult> {
  log.info("Deploying to Firebase...", { siteName });

  // functions の依存を deploy 前に解決（firebase.json predeploy の tsc が node_modules 不在で失敗するのを防ぐ）
  for (const src of readFunctionsSources(WORKSPACE_DIR)) {
    const pkgJson = join(WORKSPACE_DIR, src, "package.json");
    if (!existsSync(pkgJson)) continue;
    log.info("Installing functions deps", { source: src });
    run("npm", ["install", "--prefix", src]);
  }

  const output = run("npx", [
    "firebase",
    "deploy",
    "--non-interactive",
  ]);
  log.info("Firebase deployed", { output: output.slice(-200) });

  // "Hosting URL: https://<project>.web.app" もしくは ".firebaseapp.com" を抽出
  const urlMatch = output.match(/https:\/\/[^\s]+\.(?:web\.app|firebaseapp\.com)/);
  return { success: true, url: urlMatch?.[0] };
}

/**
 * ゲストサイトを Cloudflare または Firebase にデプロイする。
 * デプロイ先は workspace 直下の設定ファイル（wrangler.toml / firebase.json）から自動判定。
 */
export async function deploy(siteName: string): Promise<DeployResult> {
  try {
    const detected = detectProvider(WORKSPACE_DIR);
    if (!detected.ok) {
      log.error("Provider detection failed", { siteName, error: detected.error });
      return { success: false, error: detected.error };
    }

    const secrets = loadSecrets();
    if (detected.provider === "cloudflare" && !secrets.cloudflare) {
      const error = "cloudflare_secrets_not_configured";
      log.error("Cloudflare secrets missing", {
        siteName,
        provider: detected.provider,
      });
      return { success: false, error };
    }
    if (detected.provider === "firebase" && !secrets.firebase) {
      const error = "firebase_secrets_not_configured";
      log.error("Firebase secrets missing", {
        siteName,
        provider: detected.provider,
      });
      return { success: false, error };
    }

    log.info("Building frontend...", { siteName, provider: detected.provider });
    run("npx", ["vite", "build"]);

    const result =
      detected.provider === "firebase"
        ? await deployFirebase(siteName)
        : await deployCloudflare(siteName);

    log.info("Deploy complete", {
      siteName,
      provider: detected.provider,
      url: result.url,
    });
    return result;
  } catch (err) {
    const error = sanitizeError(err);
    log.error("Deploy failed", { siteName, error });
    return { success: false, error };
  }
}

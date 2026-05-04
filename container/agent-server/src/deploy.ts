import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";
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
  return execFileSync(cmd, args, {
    cwd: WORKSPACE_DIR,
    encoding: "utf-8",
    timeout: 120000,
    env: {
      ...process.env,
      // Cloudflare: wrangler が参照
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
      // Firebase: firebase-tools が参照（--token を CLI 引数に出さないことで ps から漏れない）
      FIREBASE_TOKEN: process.env.FIREBASE_TOKEN,
    },
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

async function deployFirebase(siteName: string): Promise<DeployResult> {
  log.info("Deploying to Firebase...", { siteName });
  // hosting の predeploy が無くても dist が必要なので vite build は呼び出し側で済ませている
  // functions の predeploy は firebase.json 側で npm run build を回す前提
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

    if (detected.provider === "firebase" && !process.env.FIREBASE_TOKEN) {
      const error =
        "FIREBASE_TOKEN が設定されていません。`firebase login:ci` で発行してシークレットに登録してください";
      log.error("Firebase token missing", { siteName, error });
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

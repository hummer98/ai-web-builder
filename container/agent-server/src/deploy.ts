import { execFileSync } from "node:child_process";
import { createLogger } from "./logger.js";

const log = createLogger("deploy");

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";

function run(cmd: string, args: string[]): string {
  log.info(`Running: ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, {
    cwd: WORKSPACE_DIR,
    encoding: "utf-8",
    timeout: 120000,
    env: {
      ...process.env,
      // wrangler が必要な環境変数
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    },
  }).trim();
}

export type DeployResult = {
  success: boolean;
  pagesUrl?: string;
  error?: string;
};

/**
 * ゲストサイトを Cloudflare にデプロイ
 */
export async function deploy(siteName: string): Promise<DeployResult> {
  try {
    // 1. フロントエンドビルド
    log.info("Building frontend...", { siteName });
    run("npx", ["vite", "build"]);

    // 2. Cloudflare Pages にデプロイ
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

    // 3. Cloudflare Workers にデプロイ（Hono バックエンド）
    log.info("Deploying to Cloudflare Workers...", { siteName });
    run("npx", [
      "wrangler",
      "deploy",
      "functions/api/index.ts",
      "--name",
      `${siteName}-api`,
    ]);
    log.info("Workers deployed", { siteName });

    // Pages URL を抽出
    const urlMatch = pagesOutput.match(
      /https:\/\/[^\s]+\.pages\.dev/
    );
    const pagesUrl = urlMatch?.[0];

    log.info("Deploy complete", { siteName, pagesUrl });

    return { success: true, pagesUrl };
  } catch (err) {
    const error = String(err);
    log.error("Deploy failed", { siteName, error });
    return { success: false, error };
  }
}

/**
 * R2 にアセットをアップロード
 */
export async function uploadAsset(
  bucketName: string,
  key: string,
  filePath: string
): Promise<string | null> {
  try {
    run("npx", [
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucketName}/${key}`,
      "--file",
      filePath,
    ]);

    const url = `https://${bucketName}.${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
    log.info("Asset uploaded to R2", { key, url });
    return url;
  } catch (err) {
    log.error("R2 upload failed", { key, error: String(err) });
    return null;
  }
}

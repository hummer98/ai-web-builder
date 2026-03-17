import jwt from "jsonwebtoken";
import { Octokit } from "@octokit/rest";
import { readFileSync } from "node:fs";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");

const APP_ID = process.env.GITHUB_APP_ID;
const PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
const PRIVATE_KEY_RAW = process.env.GITHUB_APP_PRIVATE_KEY;

let cachedToken: { token: string; expiresAt: number } | null = null;
let installationId: number | null = null;

function getPrivateKey(): string {
  if (PRIVATE_KEY_RAW) return PRIVATE_KEY_RAW;
  if (PRIVATE_KEY_PATH) {
    const resolved = PRIVATE_KEY_PATH.replace(/^~/, process.env.HOME ?? "");
    return readFileSync(resolved, "utf-8");
  }
  throw new Error(
    "GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH must be set"
  );
}

function createJWT(): string {
  const privateKey = getPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 10 * 60, // 10 minutes
      iss: APP_ID,
    },
    privateKey,
    { algorithm: "RS256" }
  );
}

async function getInstallationId(): Promise<number> {
  if (installationId) return installationId;

  const jwtToken = createJWT();
  const octokit = new Octokit({ auth: jwtToken });
  const { data } = await octokit.apps.listInstallations();

  if (data.length === 0) {
    throw new Error("No installations found for GitHub App");
  }

  installationId = data[0].id;
  log.info("GitHub App installation found", { installationId });
  return installationId;
}

/**
 * GitHub App の Installation Token を取得（キャッシュ付き、自動更新）
 */
export async function getInstallationToken(): Promise<string> {
  // キャッシュが有効なら再利用（5分前にリフレッシュ）
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const id = await getInstallationId();
  const jwtToken = createJWT();
  const octokit = new Octokit({ auth: jwtToken });
  const { data } = await octokit.apps.createInstallationAccessToken({
    installation_id: id,
  });

  cachedToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  };

  log.info("GitHub App token refreshed", {
    expiresAt: data.expires_at,
  });

  return data.token;
}

/**
 * 認証済み Octokit インスタンスを取得
 */
export async function getOctokit(): Promise<Octokit> {
  const token = await getInstallationToken();
  return new Octokit({ auth: token });
}

/**
 * GitHub App が利用可能か
 */
export function isGitHubAppConfigured(): boolean {
  return !!(APP_ID && (PRIVATE_KEY_PATH || PRIVATE_KEY_RAW));
}

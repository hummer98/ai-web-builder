import { execFileSync } from "node:child_process";
import { getInstallationToken, isGitHubAppConfigured } from "./github-app.js";
import { createLogger } from "./logger.js";
import { sanitizeError } from "./utils.js";

const log = createLogger("agent-server");

function getWorkspaceDir(): string {
  return process.env.WORKSPACE_DIR ?? "./workspace";
}

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: getWorkspaceDir(),
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

/**
 * ワークスペースに変更があるか
 */
export function hasChanges(): boolean {
  const status = git("status", "--porcelain");
  return status.length > 0;
}

/**
 * 自動コミット（ai-web-builder[bot] 名義）
 */
export function autoCommit(message: string): string | null {
  if (!hasChanges()) {
    log.info("No changes to commit");
    return null;
  }

  git("add", "-A");
  git(
    "-c", "user.name=ai-web-builder[bot]",
    "-c", "user.email=ai-web-builder[bot]@users.noreply.github.com",
    "commit", "-m", message
  );

  const hash = git("rev-parse", "--short", "HEAD");
  log.info("Auto-committed", { hash, message });
  return hash;
}

/**
 * GitHub に push（App トークンで認証）
 */
export async function autoPush(): Promise<void> {
  if (!isGitHubAppConfigured()) {
    log.warn("GitHub App not configured, skipping push");
    return;
  }

  try {
    const token = await getInstallationToken();
    const remoteUrl = git("remote", "get-url", "origin");

    // HTTPS URL にトークンを埋め込む
    const authedUrl = remoteUrl.replace(
      /https:\/\/(.*@)?github\.com/,
      `https://x-access-token:${token}@github.com`
    );

    git("push", authedUrl, "HEAD:main");
    log.info("Auto-pushed to GitHub");
  } catch (err) {
    log.error("Auto-push failed", { error: sanitizeError(err) });
  }
}

/**
 * 変更を元に戻す（git revert HEAD）
 */
export function undoLastCommit(): string | null {
  try {
    git(
      "-c", "user.name=ai-web-builder[bot]",
      "-c", "user.email=ai-web-builder[bot]@users.noreply.github.com",
      "revert", "HEAD", "--no-edit"
    );
    const hash = git("rev-parse", "--short", "HEAD");
    log.info("Reverted last commit", { hash });
    return hash;
  } catch (err) {
    log.error("Revert failed", { error: sanitizeError(err) });
    return null;
  }
}

/**
 * コミット履歴を取得。
 *
 * Zod 層を経由しない呼び出しがあっても安全になるよう、関数内でも
 * count を [1, 100] にクランプし、NaN/Infinity はデフォルト 20 にフォールバックする。
 */
export function getHistory(count: number = 20): { hash: string; message: string; date: string }[] {
  const safe = Number.isFinite(count)
    ? Math.max(1, Math.min(100, Math.floor(count)))
    : 20;
  try {
    const raw = git(
      "log",
      `--pretty=format:%h%n%s%n%ci`,
      `-${safe}`
    );
    if (!raw) return [];

    const lines = raw.split("\n");
    const commits: { hash: string; message: string; date: string }[] = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      commits.push({
        hash: lines[i],
        message: lines[i + 1],
        date: lines[i + 2],
      });
    }
    log.info("Got history", { count: commits.length });
    return commits;
  } catch (err) {
    log.error("Get history failed", { error: sanitizeError(err) });
    return [];
  }
}

/**
 * 指定コミットの状態にファイルを戻す（新規コミットとして記録）
 *
 * 入口で hash を再検証する (Zod 層との二重防御)。git execFileSync は引数配列で渡るため
 * シェル注入は起きないが、`-` 始まりのオプション偽装や空白文字が紛れる事故を未然に防ぐ。
 */
const HASH_REGEX = /^[0-9a-f]{4,40}$/;

export function revertToCommit(hash: string): string | null {
  if (!HASH_REGEX.test(hash)) {
    log.error("Revert to commit failed: invalid hash", { hash });
    return null;
  }
  try {
    git("checkout", hash, "--", ".");
    git("add", "-A");
    git(
      "-c", "user.name=ai-web-builder[bot]",
      "-c", "user.email=ai-web-builder[bot]@users.noreply.github.com",
      "commit", "-m", `Revert to ${hash}`
    );
    const newHash = git("rev-parse", "--short", "HEAD");
    log.info("Reverted to commit", { target: hash, newHash });
    return newHash;
  } catch (err) {
    log.error("Revert to commit failed", { error: sanitizeError(err) });
    return null;
  }
}


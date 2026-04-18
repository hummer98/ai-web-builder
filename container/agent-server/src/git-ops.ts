import { execFileSync } from "node:child_process";
import { getInstallationToken, getOctokit, isGitHubAppConfigured } from "./github-app.js";
import { createLogger } from "./logger.js";

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

export type AutoPushResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "push-failed"; error?: string };

/**
 * GitHub に push（App トークンで認証）
 *
 * 結果を返し、例外は投げない。呼び出し側が失敗をユーザー通知などに利用できる。
 */
export async function autoPush(): Promise<AutoPushResult> {
  if (!isGitHubAppConfigured()) {
    log.warn("GitHub App not configured, skipping push");
    return { ok: false, reason: "not-configured" };
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
    return { ok: true };
  } catch (err) {
    log.error("Auto-push failed", { error: String(err) });
    return { ok: false, reason: "push-failed", error: String(err) };
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
    log.error("Revert failed", { error: String(err) });
    return null;
  }
}

/**
 * コミット履歴を取得
 */
export function getHistory(count: number = 20): { hash: string; message: string; date: string }[] {
  try {
    const raw = git(
      "log",
      `--pretty=format:%h%n%s%n%ci`,
      `-${count}`
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
    log.error("Get history failed", { error: String(err) });
    return [];
  }
}

/**
 * 指定コミットの状態にファイルを戻す（新規コミットとして記録）
 */
export function revertToCommit(hash: string): string | null {
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
    log.error("Revert to commit failed", { error: String(err) });
    return null;
  }
}

/**
 * Issue を作成（変更履歴の記録用）
 */
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string
): Promise<number | null> {
  if (!isGitHubAppConfigured()) {
    log.warn("GitHub App not configured, skipping issue creation");
    return null;
  }

  try {
    const octokit = await getOctokit();
    const { data } = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
    });
    log.info("Issue created", { number: data.number, title });
    return data.number;
  } catch (err) {
    log.error("Issue creation failed", { error: String(err) });
    return null;
  }
}

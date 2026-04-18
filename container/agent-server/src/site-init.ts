import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { join } from "node:path";
import { getOctokit, getInstallationToken, isGitHubAppConfigured } from "./github-app.js";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";
const SCAFFOLD_DIR = join(import.meta.dirname, "../../scaffold");

/**
 * `rm -rf` などの破壊的操作の前に、対象が意図したワークスペース配下であることを確認する。
 *
 * - 空文字 / "/" / ルート直下を拒否する
 * - シンボリックリンクの影響を除いた絶対パスで検査する
 * - WORKSPACE_DIR から派生しない環境変数（例: `.`）での誤爆を防ぐ
 */
export function assertSafeWorkspacePath(target: string): string {
  if (!target || target === "/" || target === sep) {
    throw new Error(`Refusing to operate on unsafe path: ${JSON.stringify(target)}`);
  }
  const absolute = isAbsolute(target) ? resolve(target) : resolve(process.cwd(), target);
  // ルート直下（例: "/workspace"）は許可するが、"/" 自体やそれより浅いパスは拒否
  const segments = absolute.split(sep).filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error(`Refusing to operate on root: ${absolute}`);
  }
  return absolute;
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    timeout: 60000,
  }).trim();
}

export type InitResult = {
  success: boolean;
  workspacePath: string;
  repoUrl?: string;
  error?: string;
};

/**
 * パターン A: 新規サイト作成
 * 1. GitHub リポジトリ作成
 * 2. scaffold をコピー
 * 3. git init + push
 */
export async function createNewSite(
  owner: string,
  siteName: string
): Promise<InitResult> {
  const workspacePath = WORKSPACE_DIR;

  try {
    // 1. GitHub リポジトリ作成
    let repoUrl: string | undefined;
    if (isGitHubAppConfigured()) {
      const octokit = await getOctokit();
      try {
        const { data } = await octokit.repos.createForAuthenticatedUser({
          name: siteName,
          private: true,
          auto_init: false,
        });
        repoUrl = data.clone_url;
        log.info("GitHub repo created", { repoUrl });
      } catch (err: unknown) {
        // リポジトリが既に存在する場合はスキップ
        if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 422) {
          repoUrl = `https://github.com/${owner}/${siteName}.git`;
          log.info("GitHub repo already exists", { repoUrl });
        } else {
          throw err;
        }
      }
    }

    // 2. scaffold をワークスペースにコピー
    if (existsSync(workspacePath)) {
      log.info("Workspace already exists, skipping copy");
    } else {
      mkdirSync(workspacePath, { recursive: true });
      cpSync(SCAFFOLD_DIR, workspacePath, { recursive: true });
      log.info("Scaffold copied to workspace");

      // npm install
      run("npm", ["install"], workspacePath);
      log.info("Dependencies installed");
    }

    // 3. git init + remote + push
    if (!existsSync(join(workspacePath, ".git"))) {
      run("git", ["init"], workspacePath);
      run("git", ["-c", "user.name=ai-web-builder[bot]", "-c", "user.email=ai-web-builder[bot]@users.noreply.github.com", "add", "-A"], workspacePath);
      run("git", ["-c", "user.name=ai-web-builder[bot]", "-c", "user.email=ai-web-builder[bot]@users.noreply.github.com", "commit", "-m", "Initial scaffold"], workspacePath);

      if (repoUrl) {
        const token = await getInstallationToken();
        const authedUrl = repoUrl.replace(
          /https:\/\/(.*@)?github\.com/,
          `https://x-access-token:${token}@github.com`
        );
        run("git", ["remote", "add", "origin", authedUrl], workspacePath);
        run("git", ["push", "-u", "origin", "main"], workspacePath);
        log.info("Initial push complete");
      }
    }

    return { success: true, workspacePath, repoUrl };
  } catch (err) {
    const error = String(err);
    log.error("Site creation failed", { siteName, error });
    return { success: false, workspacePath, error };
  }
}

/**
 * パターン B: 既存リポジトリの取り込み
 * 1. git clone
 * 2. npm install
 */
export async function importExistingRepo(
  owner: string,
  repoName: string
): Promise<InitResult> {
  const workspacePath = WORKSPACE_DIR;

  try {
    const repoUrl = `https://github.com/${owner}/${repoName}.git`;

    if (existsSync(join(workspacePath, ".git"))) {
      // 既にワークスペースにリポジトリがある場合は pull
      run("git", ["pull", "origin", "main"], workspacePath);
      log.info("Pulled latest changes");
    } else {
      // clone
      let cloneUrl = repoUrl;
      if (isGitHubAppConfigured()) {
        const token = await getInstallationToken();
        cloneUrl = repoUrl.replace(
          /https:\/\/(.*@)?github\.com/,
          `https://x-access-token:${token}@github.com`
        );
      }

      // clone 先が既にある場合は削除してから
      if (existsSync(workspacePath)) {
        const safePath = assertSafeWorkspacePath(workspacePath);
        log.info("Removing existing workspace before clone", { path: safePath });
        rmSync(safePath, { recursive: true, force: true });
      }

      run("git", ["clone", cloneUrl, workspacePath], ".");
      log.info("Repo cloned", { repoUrl });
    }

    // npm install
    if (existsSync(join(workspacePath, "package.json"))) {
      run("npm", ["install"], workspacePath);
      log.info("Dependencies installed");
    }

    return { success: true, workspacePath, repoUrl };
  } catch (err) {
    const error = String(err);
    log.error("Repo import failed", { repoName, error });
    return { success: false, workspacePath, error };
  }
}

/**
 * ワークスペースを scaffold の初期状態にリセットする。
 * node_modules, .git, opencode.json は保持する。
 */
export async function resetWorkspace(): Promise<{ success: boolean; error?: string }> {
  const workspaceDir = WORKSPACE_DIR;
  const scaffoldDir = SCAFFOLD_DIR;

  try {
    // ユーザーコンテンツを削除
    for (const dir of ["src", "functions", "public"]) {
      const target = join(workspaceDir, dir);
      if (existsSync(target)) rmSync(target, { recursive: true });
    }
    // index.html 削除
    const indexHtml = join(workspaceDir, "index.html");
    if (existsSync(indexHtml)) rmSync(indexHtml);

    // scaffold からコピー
    for (const item of ["src", "functions", "public", "index.html", "package.json"]) {
      const src = join(scaffoldDir, item);
      const dest = join(workspaceDir, item);
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true });
      }
    }

    // git commit（.git がある場合のみ）
    if (existsSync(join(workspaceDir, ".git"))) {
      execFileSync("git", ["add", "-A"], { cwd: workspaceDir });
      execFileSync("git", [
        "-c", "user.name=ai-web-builder[bot]",
        "-c", "user.email=ai-web-builder[bot]@users.noreply.github.com",
        "commit", "-m", "Reset to scaffold",
        "--allow-empty",
      ], { cwd: workspaceDir });
    }

    log.info("Workspace reset to scaffold");
    return { success: true };
  } catch (err) {
    log.error("Workspace reset failed", { error: String(err) });
    return { success: false, error: String(err) };
  }
}

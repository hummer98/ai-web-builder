import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getOctokit, getInstallationToken, isGitHubAppConfigured } from "./github-app.js";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";
const SCAFFOLD_DIR = join(import.meta.dirname, "../../scaffold");

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
        execFileSync("rm", ["-rf", workspacePath]);
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

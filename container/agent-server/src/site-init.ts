import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { postprocessOpencodeJson } from "../../opencode-postprocess.mjs";
import { getOctokit, getInstallationToken, isGitHubAppConfigured } from "./github-app.js";
import { createLogger } from "./logger.js";
import { sanitizeError } from "./utils.js";

const log = createLogger("agent-server");

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "./workspace";
const CONTAINER_DIR = resolve(import.meta.dirname, "../..");
const SCAFFOLD_DIR = join(CONTAINER_DIR, "scaffold");
const COMMON_MD_ABS_PATH = join(CONTAINER_DIR, "instructions", "common.md");

/**
 * scaffold をコピーしたワークスペース内の opencode.json に対して、
 * - 共通 instructions (common.md) の絶対パス注入
 * - SITE_BRIEF.md (workspace 直下) の絶対パス注入
 * - nano-banana MCP への GEMINI_API_KEY 注入
 * を行う。start.sh (本番) と対称になるローカル開発側の経路。
 */
export function postprocessWorkspaceOpencodeJson(workspacePath: string): void {
  postprocessOpencodeJson(join(workspacePath, "opencode.json"), {
    commonMdAbsPath: COMMON_MD_ABS_PATH,
    siteBriefAbsPath: resolve(workspacePath, "SITE_BRIEF.md"),
    nanoBananaApiKey: process.env.GEMINI_API_KEY,
  });
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

      // opencode.json の後処理（共通 instructions 絶対パス注入）
      postprocessWorkspaceOpencodeJson(workspacePath);

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
    const error = sanitizeError(err);
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
    const error = sanitizeError(err);
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
    for (const item of ["src", "functions", "public", "index.html", "package.json", "opencode.json", "AGENTS.md", "SITE_BRIEF.md"]) {
      const src = join(scaffoldDir, item);
      const dest = join(workspaceDir, item);
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true });
      }
    }

    // opencode.json を再配置したので postprocess で共通 instructions を注入し直す
    if (existsSync(join(workspaceDir, "opencode.json"))) {
      postprocessWorkspaceOpencodeJson(workspaceDir);
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
    log.error("Workspace reset failed", { error: sanitizeError(err) });
    return { success: false, error: sanitizeError(err) };
  }
}

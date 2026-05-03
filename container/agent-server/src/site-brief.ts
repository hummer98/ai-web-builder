import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("agent-server");

export const SITE_BRIEF_FILENAME = "SITE_BRIEF.md";

/**
 * SITE_BRIEF.md の初期テンプレ。
 *
 * - ユーザーが書くべき項目を見出し付きで提示
 * - 中身は空 (AI が「未設定」と認識できる)
 * - editor 側のフォームは見出しでパースしてフィールドに分割する
 */
export const SITE_BRIEF_TEMPLATE = `# サイトの設計図

このファイルは AI がサイトを編集する際に毎回参照する基本情報です。
雰囲気が変わったら、AI に「ターゲットを変えて」「もっとカジュアルに」等で更新を依頼できます。

## 何のサイト


## 場所


## 来てほしい人


## 雰囲気・トーン


## 大事なメモ

`;

function getWorkspaceDir(workspaceDir?: string): string {
  return workspaceDir ?? process.env.WORKSPACE_DIR ?? "./workspace";
}

function briefPath(workspaceDir?: string): string {
  return join(getWorkspaceDir(workspaceDir), SITE_BRIEF_FILENAME);
}

/**
 * SITE_BRIEF.md を読む。存在しなければテンプレを返す (作成はしない)。
 */
export function readSiteBrief(workspaceDir?: string): string {
  const p = briefPath(workspaceDir);
  if (!existsSync(p)) return SITE_BRIEF_TEMPLATE;
  return readFileSync(p, "utf-8");
}

/**
 * SITE_BRIEF.md に書き込む (上書き)。
 */
export function writeSiteBrief(content: string, workspaceDir?: string): void {
  const p = briefPath(workspaceDir);
  writeFileSync(p, content, "utf-8");
}

/**
 * SITE_BRIEF.md の内容が「実質空」かを判定する。
 * 編集 UI が「初回ヒアリングを出すべきか」を判断するのに使う。
 *
 * 判定: テンプレの見出しだけがあって本文が無い (空白行のみ) 状態
 */
export function isSiteBriefEmpty(content: string): boolean {
  // 見出し / 空行 / 「このファイルは…」のような説明文 を取り除いて、本文があるか確認
  const lines = content.split("\n");
  let hasBody = false;
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("##")) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    // セクション内で空白でない行があれば中身あり
    if (trimmed.length > 0) {
      hasBody = true;
      break;
    }
  }
  return !hasBody;
}

/**
 * SITE_BRIEF.md を git commit する (変更がある場合のみ)。
 * push は呼び出し側の責務。
 */
export function commitSiteBrief(
  message: string,
  workspaceDir?: string
): string | null {
  const cwd = getWorkspaceDir(workspaceDir);
  try {
    // 変更検査
    const status = execFileSync(
      "git",
      ["status", "--porcelain", SITE_BRIEF_FILENAME],
      { cwd, encoding: "utf-8", timeout: 30000 }
    ).trim();
    if (status.length === 0) return null;

    execFileSync("git", ["add", SITE_BRIEF_FILENAME], {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=ai-web-builder[bot]",
        "-c",
        "user.email=ai-web-builder[bot]@users.noreply.github.com",
        "commit",
        "-m",
        message,
      ],
      { cwd, encoding: "utf-8", timeout: 30000 }
    );
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
    log.info("SITE_BRIEF committed", { hash });
    return hash;
  } catch (err) {
    log.error("SITE_BRIEF commit failed", { error: String(err) });
    return null;
  }
}

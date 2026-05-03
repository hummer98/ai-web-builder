import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SITE_BRIEF_FILENAME,
  SITE_BRIEF_TEMPLATE,
  commitSiteBrief,
  isSiteBriefEmpty,
  readSiteBrief,
  writeSiteBrief,
} from "./site-brief.js";

let tmp: string;

function gitInTmp(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: tmp,
    encoding: "utf-8",
  }).trim();
}

describe("site-brief", () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "site-brief-"));
    gitInTmp("init", "-q");
    gitInTmp("config", "user.name", "Test");
    gitInTmp("config", "user.email", "test@example.com");
    // 最初の commit が無いと commitSiteBrief の git status が空のままなので種コミットを作る
    writeFileSync(join(tmp, "README.md"), "init", "utf-8");
    gitInTmp("add", "-A");
    gitInTmp("commit", "-q", "-m", "init");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("readSiteBrief", () => {
    it("ファイル無しならテンプレを返す", () => {
      expect(readSiteBrief(tmp)).toBe(SITE_BRIEF_TEMPLATE);
    });

    it("ファイルありならその内容を返す", () => {
      writeFileSync(join(tmp, SITE_BRIEF_FILENAME), "# 自分のサイト\n", "utf-8");
      expect(readSiteBrief(tmp)).toBe("# 自分のサイト\n");
    });
  });

  describe("writeSiteBrief", () => {
    it("ファイルを上書きする", () => {
      writeSiteBrief("hello", tmp);
      expect(readFileSync(join(tmp, SITE_BRIEF_FILENAME), "utf-8")).toBe(
        "hello"
      );
      writeSiteBrief("world", tmp);
      expect(readFileSync(join(tmp, SITE_BRIEF_FILENAME), "utf-8")).toBe(
        "world"
      );
    });
  });

  describe("isSiteBriefEmpty", () => {
    it("テンプレそのままは empty", () => {
      expect(isSiteBriefEmpty(SITE_BRIEF_TEMPLATE)).toBe(true);
    });

    it("見出しの下に本文があれば empty ではない", () => {
      const filled = SITE_BRIEF_TEMPLATE.replace(
        "## 何のサイト\n\n",
        "## 何のサイト\n新宿のカフェ\n\n"
      );
      expect(isSiteBriefEmpty(filled)).toBe(false);
    });

    it("見出し外の説明文だけでは empty 扱い", () => {
      // テンプレ冒頭の「このファイルは AI が…」だけ残して本文が空
      const onlyDescription = `# サイトの設計図

これは説明文です。

## 何のサイト


## 場所

`;
      expect(isSiteBriefEmpty(onlyDescription)).toBe(true);
    });
  });

  describe("commitSiteBrief", () => {
    it("変更が無ければ null", () => {
      expect(commitSiteBrief("first commit", tmp)).toBeNull();
    });

    it("ファイルを書いた後にコミットすれば hash が返る", () => {
      writeSiteBrief("# my site\n", tmp);
      const hash = commitSiteBrief("サイト情報を保存", tmp);
      expect(hash).toMatch(/^[0-9a-f]+$/);

      const author = gitInTmp("log", "-1", "--format=%an");
      expect(author).toBe("ai-web-builder[bot]");
    });

    it("SITE_BRIEF.md 以外の変更はコミット対象に含めない", () => {
      writeSiteBrief("# brief\n", tmp);
      writeFileSync(join(tmp, "other.txt"), "untracked", "utf-8");
      const hash = commitSiteBrief("update brief", tmp);
      expect(hash).toBeTruthy();
      const status = gitInTmp("status", "--porcelain");
      expect(status).toContain("other.txt"); // ステージされず残る
    });
  });
});

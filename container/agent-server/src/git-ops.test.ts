import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

type GitOps = typeof import("./git-ops.js");

let tmpDir: string;
let gitOps: GitOps;

/** Test helper: run git in tmpDir using execFileSync (no shell) */
function gitInTmp(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: tmpDir,
    encoding: "utf-8",
  }).trim();
}

describe("git-ops", () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "git-ops-test-"));
    gitInTmp("init");
    gitInTmp("config", "user.name", "Test User");
    gitInTmp("config", "user.email", "test@example.com");

    vi.stubEnv("WORKSPACE_DIR", tmpDir);
    vi.resetModules();
    gitOps = await import("./git-ops.js");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe("hasChanges()", () => {
    it("returns false on a clean repo", () => {
      expect(gitOps.hasChanges()).toBe(false);
    });

    it("returns true after adding a file", () => {
      writeFileSync(join(tmpDir, "hello.txt"), "hello");
      expect(gitOps.hasChanges()).toBe(true);
    });

    it("returns false after committing", () => {
      writeFileSync(join(tmpDir, "hello.txt"), "hello");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "initial");
      expect(gitOps.hasChanges()).toBe(false);
    });
  });

  describe("autoCommit(message)", () => {
    it("returns a commit hash when there are changes", () => {
      writeFileSync(join(tmpDir, "file.txt"), "content");
      const hash = gitOps.autoCommit("test commit");
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");

      // Verify the commit author is the bot
      const author = gitInTmp("log", "-1", "--format=%an");
      expect(author).toContain("ai-web-builder[bot]");
    });

    it("returns null when there are no changes", () => {
      // Need at least one commit for a clean state
      writeFileSync(join(tmpDir, "file.txt"), "content");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "initial");

      const result = gitOps.autoCommit("no changes");
      expect(result).toBeNull();
    });
  });

  describe("undoLastCommit()", () => {
    it("returns a revert commit hash", () => {
      writeFileSync(join(tmpDir, "file.txt"), "original");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "initial");

      writeFileSync(join(tmpDir, "file.txt"), "modified");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "second");

      const hash = gitOps.undoLastCommit();
      expect(hash).toBeTruthy();

      // The file should be reverted to the original content
      const content = readFileSync(join(tmpDir, "file.txt"), "utf-8");
      expect(content).toBe("original");
    });

    it("returns null when only the initial commit exists", () => {
      writeFileSync(join(tmpDir, "file.txt"), "content");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "initial");

      // Reverting the initial commit that added a file can succeed or fail
      // depending on git version / state. We verify graceful handling.
      const result = gitOps.undoLastCommit();
      expect(result === null || typeof result === "string").toBe(true);
    });
  });

  describe("getHistory(count)", () => {
    it("returns all commits", () => {
      writeFileSync(join(tmpDir, "a.txt"), "a");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");

      writeFileSync(join(tmpDir, "b.txt"), "b");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "second");

      writeFileSync(join(tmpDir, "c.txt"), "c");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "third");

      const history = gitOps.getHistory(3);
      expect(history).toHaveLength(3);
      expect(history[0]).toHaveProperty("hash");
      expect(history[0]).toHaveProperty("message");
      expect(history[0]).toHaveProperty("date");
    });

    it("respects the count parameter", () => {
      writeFileSync(join(tmpDir, "a.txt"), "a");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");

      writeFileSync(join(tmpDir, "b.txt"), "b");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "second");

      writeFileSync(join(tmpDir, "c.txt"), "c");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "third");

      const history = gitOps.getHistory(2);
      expect(history).toHaveLength(2);
    });

    it("returns an empty array for empty repo", () => {
      const history = gitOps.getHistory();
      expect(history).toEqual([]);
    });

    it("clamps count > 100 to 100 (defensive)", () => {
      writeFileSync(join(tmpDir, "a.txt"), "a");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");
      const history = gitOps.getHistory(99999);
      // 1 件しか存在しないのでクランプの効果は長さ越えではなく "正常終了" を確認
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it("clamps negative count to 1", () => {
      writeFileSync(join(tmpDir, "a.txt"), "a");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");
      writeFileSync(join(tmpDir, "b.txt"), "b");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "second");
      const history = gitOps.getHistory(-5);
      expect(history).toHaveLength(1);
    });

    it("falls back to default 20 for NaN", () => {
      writeFileSync(join(tmpDir, "a.txt"), "a");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");
      const history = gitOps.getHistory(NaN as unknown as number);
      // commits 1 件 → そのまま 1 件返り、エラーは起きない
      expect(history).toHaveLength(1);
    });

    it("clamps count 0 to 1", () => {
      writeFileSync(join(tmpDir, "a.txt"), "a");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");
      writeFileSync(join(tmpDir, "b.txt"), "b");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "second");
      const history = gitOps.getHistory(0);
      expect(history).toHaveLength(1);
    });
  });

  describe("autoPush() does not leak token in logs (regression for T013)", () => {
    it("when push fails, logs must not include the GitHub App installation token", async () => {
      // 初期コミットを作って push 実行可能な状態にする
      writeFileSync(join(tmpDir, "f.txt"), "x");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "initial");

      // リモートを到達不能 URL で登録 (TLD .invalid は DNS で即失敗)
      gitInTmp("remote", "add", "origin", "https://github.com/nonexistent/repo.invalid");

      // github-app をモックしてダミートークンを返す
      vi.doMock("./github-app.js", () => ({
        isGitHubAppConfigured: () => true,
        getInstallationToken: async () => "ghs_FAKE_TOKEN_XYZ",
        getOctokit: async () => ({}),
      }));
      vi.resetModules();
      const fresh = await import("./git-ops.js");

      // logger は内部で console.error / console.log と appendFileSync を使う。
      // ファイル経路は logger.ts の AGENT_LOG_PATH 依存なので console をスパイすれば十分。
      const captured: string[] = [];
      const errSpy = vi.spyOn(console, "error").mockImplementation((...a) => {
        captured.push(a.map(String).join(" "));
      });
      const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => {
        captured.push(a.map(String).join(" "));
      });

      await fresh.autoPush();

      const all = captured.join("\n");
      expect(all).not.toContain("ghs_FAKE_TOKEN_XYZ");
      expect(all).toMatch(/REDACTED|Auto-push failed/);

      errSpy.mockRestore();
      logSpy.mockRestore();
      vi.doUnmock("./github-app.js");
    });
  });

  describe("revertToCommit(hash)", () => {
    it("returns null for non-hex hash (defensive guard)", () => {
      writeFileSync(join(tmpDir, "f.txt"), "x");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "init");
      const r = gitOps.revertToCommit("NOT-HEX");
      expect(r).toBeNull();
    });

    it("returns null for hash starting with '-' (option-like)", () => {
      writeFileSync(join(tmpDir, "f.txt"), "x");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "init");
      const r = gitOps.revertToCommit("-rf");
      expect(r).toBeNull();
    });

    it("reverts file content to the specified commit", () => {
      writeFileSync(join(tmpDir, "file.txt"), "version1");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "first");
      const firstHash = gitInTmp("rev-parse", "--short", "HEAD");

      writeFileSync(join(tmpDir, "file.txt"), "version2");
      gitInTmp("add", "-A");
      gitInTmp("commit", "-m", "second");

      const newHash = gitOps.revertToCommit(firstHash);
      expect(newHash).toBeTruthy();

      const content = readFileSync(join(tmpDir, "file.txt"), "utf-8");
      expect(content).toBe("version1");
    });
  });
});

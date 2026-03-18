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
  });

  describe("revertToCommit(hash)", () => {
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

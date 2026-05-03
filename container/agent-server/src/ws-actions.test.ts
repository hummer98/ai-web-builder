import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

type WsActions = typeof import("./ws-actions.js");
type GitOps = typeof import("./git-ops.js");

let tmpDir: string;
let wsActions: WsActions;
let gitOps: GitOps;

function gitInTmp(...args: string[]): string {
  return execFileSync("git", args, { cwd: tmpDir, encoding: "utf-8" }).trim();
}

class FakeWs {
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  parsed(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

describe("ws-actions", () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ws-actions-test-"));
    gitInTmp("init");
    gitInTmp("config", "user.name", "Test User");
    gitInTmp("config", "user.email", "test@example.com");
    writeFileSync(join(tmpDir, "init.txt"), "init");
    gitInTmp("add", ".");
    gitInTmp("commit", "-m", "initial");

    vi.stubEnv("WORKSPACE_DIR", tmpDir);
    vi.resetModules();
    wsActions = await import("./ws-actions.js");
    gitOps = await import("./git-ops.js");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("./git-ops.js");
    vi.doUnmock("./deploy.js");
    vi.resetModules();
  });

  describe("executeUndo", () => {
    it("sends {type:'git', action:'undo'} on successful undo", async () => {
      writeFileSync(join(tmpDir, "edit.txt"), "ai edit");
      const hash = gitOps.autoCommit("AI edit");
      expect(hash).toBeTruthy();

      const ws = new FakeWs();
      await wsActions.executeUndo(ws);

      const msgs = ws.parsed() as { type: string; action?: string; message?: string }[];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe("git");
      expect(msgs[0].action).toBe("undo");
      expect(msgs[0].message).toContain("変更を元に戻しました");
    });

    it("sends {type:'error'} when there is nothing to undo", async () => {
      vi.resetModules();
      vi.doMock("./git-ops.js", () => ({
        undoLastCommit: vi.fn(() => null),
        autoPush: vi.fn(async () => {}),
      }));
      const reloaded = await import("./ws-actions.js");

      const ws = new FakeWs();
      await reloaded.executeUndo(ws);

      const msgs = ws.parsed() as { type: string; message?: string }[];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe("error");
      expect(msgs[0].message).toContain("元に戻す変更がありません");
    });

    it("sends {type:'error'} when undoLastCommit throws", async () => {
      vi.resetModules();
      vi.doMock("./git-ops.js", () => ({
        undoLastCommit: vi.fn(() => {
          throw new Error("git index locked");
        }),
        autoPush: vi.fn(async () => {}),
      }));
      const reloaded = await import("./ws-actions.js");

      const ws = new FakeWs();
      await reloaded.executeUndo(ws);

      const msgs = ws.parsed() as { type: string; message?: string }[];
      expect(msgs[0].type).toBe("error");
      expect(msgs[0].message).toContain("元に戻す操作に失敗しました");
    });

    it("does not crash when autoPush rejects (logs only)", async () => {
      writeFileSync(join(tmpDir, "edit.txt"), "ai edit");
      gitOps.autoCommit("AI edit");

      const ws = new FakeWs();
      // No remote configured → autoPush should fail; executeUndo must not throw
      await expect(wsActions.executeUndo(ws)).resolves.toBeUndefined();
      const msgs = ws.parsed() as { type: string }[];
      expect(msgs[0].type).toBe("git");
    });
  });

  describe("executeDeploy", () => {
    it("sends {type:'deploy', success:true, url} on success", async () => {
      vi.resetModules();
      vi.doMock("./deploy.js", () => ({
        deploy: vi.fn(async () => ({ success: true, pagesUrl: "https://example.pages.dev" })),
      }));
      const reloaded = await import("./ws-actions.js");

      const ws = new FakeWs();
      await reloaded.executeDeploy(ws, "example.com");

      const msgs = ws.parsed() as { type: string; success?: boolean; url?: string; message?: string }[];
      expect(msgs[0]).toEqual({ type: "status", message: "deploying" });
      expect(msgs[1]).toEqual({
        type: "deploy",
        success: true,
        url: "https://example.pages.dev",
      });
    });

    it("sends {type:'deploy', success:false, error} on failure", async () => {
      vi.resetModules();
      vi.doMock("./deploy.js", () => ({
        deploy: vi.fn(async () => ({ success: false, error: "build failed" })),
      }));
      const reloaded = await import("./ws-actions.js");

      const ws = new FakeWs();
      await reloaded.executeDeploy(ws, "example.com");

      const msgs = ws.parsed() as { type: string; success?: boolean; error?: string }[];
      expect(msgs[1]).toEqual({
        type: "deploy",
        success: false,
        error: "build failed",
      });
    });

    it("sends {type:'deploy', success:false} when deploy throws", async () => {
      vi.resetModules();
      vi.doMock("./deploy.js", () => ({
        deploy: vi.fn(async () => {
          throw new Error("network down");
        }),
      }));
      const reloaded = await import("./ws-actions.js");

      const ws = new FakeWs();
      await reloaded.executeDeploy(ws, "example.com");

      const msgs = ws.parsed() as { type: string; success?: boolean; error?: string }[];
      expect(msgs[1].type).toBe("deploy");
      expect(msgs[1].success).toBe(false);
      expect(msgs[1].error).toContain("network down");
    });
  });
});

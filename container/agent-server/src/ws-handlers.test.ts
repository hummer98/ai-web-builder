import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AutoPushResult } from "./git-ops.js";

// モック対象モジュール（テスト対象より先に定義する必要がある）
vi.mock("./git-ops.js", () => ({
  undoLastCommit: vi.fn(),
  autoPush: vi.fn(),
}));
vi.mock("./deploy.js", () => ({
  deploy: vi.fn(),
}));
vi.mock("./site-init.js", () => ({
  createNewSite: vi.fn(),
  importExistingRepo: vi.fn(),
  resetWorkspace: vi.fn(),
}));
vi.mock("./logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { handleCommand, notifyPushResult } from "./ws-handlers.js";
import { undoLastCommit, autoPush } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createNewSite, importExistingRepo, resetWorkspace } from "./site-init.js";

const mockUndo = vi.mocked(undoLastCommit);
const mockPush = vi.mocked(autoPush);
const mockDeploy = vi.mocked(deploy);
const mockCreate = vi.mocked(createNewSite);
const mockImport = vi.mocked(importExistingRepo);
const mockReset = vi.mocked(resetWorkspace);

function makeWs() {
  const sent: string[] = [];
  return {
    ws: { send: (m: string) => sent.push(m) },
    sent,
    parsed: () => sent.map((m) => JSON.parse(m)),
  };
}

const OPTS = { siteName: "my-site", defaultOwner: "alice" };

beforeEach(() => {
  vi.resetAllMocks();
  // autoPush のデフォルト戻り値（成功）
  mockPush.mockResolvedValue({ ok: true });
});

describe("notifyPushResult", () => {
  it("ok → 何も送信しない", () => {
    const { ws, sent } = makeWs();
    notifyPushResult({ ok: true }, "edit", ws);
    expect(sent).toHaveLength(0);
  });

  it("not-configured → 何も送信しない（ローカル開発時の通常ケース）", () => {
    const { ws, sent } = makeWs();
    notifyPushResult({ ok: false, reason: "not-configured" }, "edit", ws);
    expect(sent).toHaveLength(0);
  });

  it("push-failed (edit) → warning 送信", () => {
    const { ws, parsed } = makeWs();
    notifyPushResult(
      { ok: false, reason: "push-failed", error: "network" },
      "edit",
      ws
    );
    const [msg] = parsed();
    expect(msg.type).toBe("warning");
    expect(msg.code).toBe("push-failed");
    expect(msg.message).toContain("変更のバックアップに失敗");
  });

  it("push-failed (undo) → 日本語ラベルが 'undo' → '取り消し'", () => {
    const { ws, parsed } = makeWs();
    notifyPushResult({ ok: false, reason: "push-failed" }, "undo", ws);
    expect(parsed()[0].message).toContain("取り消しのバックアップに失敗");
  });

  it("push-failed (revert) → '復元'", () => {
    const { ws, parsed } = makeWs();
    notifyPushResult({ ok: false, reason: "push-failed" }, "revert", ws);
    expect(parsed()[0].message).toContain("復元のバックアップに失敗");
  });
});

describe("handleCommand: undo", () => {
  it("undo 成功 → status + response + autoPush 呼び出し", async () => {
    mockUndo.mockReturnValue("abc1234");
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "undo" }, ws, OPTS);

    expect(mockUndo).toHaveBeenCalledOnce();
    const messages = parsed();
    expect(messages[0]).toMatchObject({ type: "status", message: "undoing" });
    expect(messages[1]).toMatchObject({ type: "response" });
    expect(messages[1].message).toContain("abc1234");
    // autoPush は then チェーンで fire-and-forget
    expect(mockPush).toHaveBeenCalledOnce();
  });

  it("undo 失敗（戻す変更がない） → error 送信、autoPush 呼ばれない", async () => {
    mockUndo.mockReturnValue(null);
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "undo" }, ws, OPTS);

    const messages = parsed();
    expect(messages[0]).toMatchObject({ type: "status", message: "undoing" });
    expect(messages[1]).toMatchObject({ type: "error" });
    expect(messages[1].message).toContain("元に戻せる変更がありませんでした");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("undo 成功 → autoPush 失敗時に warning が送信される", async () => {
    mockUndo.mockReturnValue("abc1234");
    const pushResult: AutoPushResult = { ok: false, reason: "push-failed" };
    mockPush.mockResolvedValue(pushResult);

    const { ws, parsed } = makeWs();
    await handleCommand({ type: "undo" }, ws, OPTS);
    // then チェーンの完了を待つ
    await new Promise((r) => setImmediate(r));

    const warnings = parsed().filter((m) => m.type === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("push-failed");
  });
});

describe("handleCommand: deploy", () => {
  it("deploy 成功 + URL あり → status + response に URL 含む", async () => {
    mockDeploy.mockResolvedValue({
      success: true,
      pagesUrl: "https://my-site.pages.dev",
    });
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "deploy" }, ws, OPTS);

    expect(mockDeploy).toHaveBeenCalledWith("my-site");
    const messages = parsed();
    expect(messages[0]).toMatchObject({ type: "status", message: "deploying" });
    expect(messages[1].type).toBe("response");
    expect(messages[1].message).toContain("https://my-site.pages.dev");
  });

  it("deploy 成功 + URL なし → 汎用の成功メッセージ", async () => {
    mockDeploy.mockResolvedValue({ success: true });
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "deploy" }, ws, OPTS);

    const response = parsed().find((m) => m.type === "response");
    expect(response.message).toBe("サイトを公開しました！");
  });

  it("deploy 失敗 → error 送信、エラー内容を含む", async () => {
    mockDeploy.mockResolvedValue({ success: false, error: "build failed" });
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "deploy" }, ws, OPTS);

    const error = parsed().find((m) => m.type === "error");
    expect(error.message).toContain("公開に失敗しました");
    expect(error.message).toContain("build failed");
  });
});

describe("handleCommand: create / import / reset", () => {
  it("create 成功 → site-init 'created'", async () => {
    mockCreate.mockResolvedValue({
      success: true,
      workspacePath: "/w",
      repoUrl: "https://github.com/alice/new-site.git",
    });
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "create", siteName: "new-site" }, ws, OPTS);

    expect(mockCreate).toHaveBeenCalledWith("alice", "new-site");
    const init = parsed().find((m) => m.type === "site-init");
    expect(init.action).toBe("created");
    expect(init.repoUrl).toContain("new-site");
  });

  it("import 成功 → site-init 'imported'", async () => {
    mockImport.mockResolvedValue({
      success: true,
      workspacePath: "/w",
      repoUrl: "https://github.com/alice/existing.git",
    });
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "import", repoName: "existing" }, ws, OPTS);

    expect(mockImport).toHaveBeenCalledWith("alice", "existing");
    const init = parsed().find((m) => m.type === "site-init");
    expect(init.action).toBe("imported");
  });

  it("reset 失敗 → error 送信", async () => {
    mockReset.mockResolvedValue({ success: false, error: "disk full" });
    const { ws, parsed } = makeWs();

    await handleCommand({ type: "reset" }, ws, OPTS);

    const error = parsed().find((m) => m.type === "error");
    expect(error.message).toContain("リセットに失敗しました");
    expect(error.message).toContain("disk full");
  });

  it("help → HELP_TEXT を response で返す", async () => {
    const { ws, parsed } = makeWs();
    await handleCommand({ type: "help" }, ws, OPTS);
    const response = parsed()[0];
    expect(response.type).toBe("response");
    expect(response.message).toContain("チャットで指示");
  });
});

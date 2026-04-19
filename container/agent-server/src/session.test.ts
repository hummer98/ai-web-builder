import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleChatMessage,
  runInactivityTimeout,
  type ChatHandlerCtx,
} from "./chat-handler.js";

type SentMessage = { type: string; [k: string]: unknown };

function createFakeWs() {
  const sent: SentMessage[] = [];
  return {
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    sent,
  };
}

function createFakeOpencode() {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "ses_TEST" } }),
      promptAsync: vi.fn().mockResolvedValue({}),
      abort: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("handleChatMessage", () => {
  let workspaceDir: string;
  let opencode: ReturnType<typeof createFakeOpencode>;
  let ws: ReturnType<typeof createFakeWs>;
  let sessionId: string | undefined;

  const mkCtx = (): ChatHandlerCtx => ({
    opencode: opencode as never,
    ws,
    workspaceDir,
    getSessionId: () => sessionId,
    setSessionId: (id) => {
      sessionId = id;
    },
  });

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "aiwb-session-"));
    await mkdir(join(workspaceDir, "public", "uploads"), { recursive: true });
    await writeFile(
      join(workspaceDir, "public", "uploads", "test.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    opencode = createFakeOpencode();
    ws = createFakeWs();
    sessionId = undefined;
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("imageUrl なし → parts は text 1 件のみ", async () => {
    await handleChatMessage(
      { type: "chat", message: "ヘッダーを青くして" },
      mkCtx()
    );

    expect(opencode.session.create).toHaveBeenCalledOnce();
    expect(opencode.session.promptAsync).toHaveBeenCalledOnce();
    const arg = opencode.session.promptAsync.mock.calls[0][0];
    expect(arg.path.id).toBe("ses_TEST");
    expect(arg.body.parts).toHaveLength(1);
    expect(arg.body.parts[0]).toMatchObject({ type: "text" });
    expect(arg.body.parts[0].text).toContain("ヘッダーを青くして");
  });

  it("imageUrl あり → parts は [text, file] 2 件", async () => {
    await handleChatMessage(
      {
        type: "chat",
        message: "この画像を使って",
        imageUrl: "/uploads/test.png",
      },
      mkCtx()
    );

    const arg = opencode.session.promptAsync.mock.calls[0][0];
    expect(arg.body.parts).toHaveLength(2);
    expect(arg.body.parts[0].type).toBe("text");
    expect(arg.body.parts[1]).toMatchObject({
      type: "file",
      mime: "image/png",
      filename: "test.png",
    });
    expect(arg.body.parts[1].url).toMatch(/^data:image\/png;base64,/);
  });

  it("status=thinking の WS メッセージを送る", async () => {
    await handleChatMessage(
      { type: "chat", message: "テスト" },
      mkCtx()
    );
    expect(ws.sent.some((m) => m.type === "status")).toBe(true);
  });

  it("2 度目の chat は既存 sessionId を再利用する (session.create が 1 度だけ)", async () => {
    const ctx = mkCtx();
    await handleChatMessage({ type: "chat", message: "1 回目" }, ctx);
    await handleChatMessage({ type: "chat", message: "2 回目" }, ctx);

    expect(opencode.session.create).toHaveBeenCalledTimes(1);
    expect(opencode.session.promptAsync).toHaveBeenCalledTimes(2);
  });

  it("promptAsync が throw したら type:error を送り、data URL はメッセージに含めない", async () => {
    opencode.session.promptAsync.mockRejectedValueOnce(
      new Error("invalid payload: data:image/png;base64,iVBORw0...")
    );

    await handleChatMessage(
      { type: "chat", message: "失敗させる", imageUrl: "/uploads/test.png" },
      mkCtx()
    );

    const err = ws.sent.find((m) => m.type === "error");
    expect(err).toBeDefined();
    expect(String(err?.message)).not.toContain("base64,");
  });

  it("timer が注入されていれば promptAsync 直前に reset が呼ばれる", async () => {
    const timer = { reset: vi.fn(), stop: vi.fn() };
    await handleChatMessage(
      { type: "chat", message: "テスト" },
      { ...mkCtx(), timer }
    );
    expect(timer.reset).toHaveBeenCalledOnce();
    // reset は promptAsync の前に呼ばれる
    const resetOrder = timer.reset.mock.invocationCallOrder[0];
    const promptOrder = opencode.session.promptAsync.mock.invocationCallOrder[0];
    expect(resetOrder).toBeLessThan(promptOrder);
  });

  it("promptAsync throw 時に timer.stop が呼ばれる", async () => {
    opencode.session.promptAsync.mockRejectedValueOnce(new Error("boom"));
    const timer = { reset: vi.fn(), stop: vi.fn() };
    await handleChatMessage(
      { type: "chat", message: "失敗させる" },
      { ...mkCtx(), timer }
    );
    expect(timer.stop).toHaveBeenCalled();
  });
});

describe("runInactivityTimeout", () => {
  it("type:error を送る / abort を呼ぶ / sessionId を undefined に戻す", () => {
    const sent: unknown[] = [];
    const ws = { send: (d: string) => sent.push(JSON.parse(d)) };
    const abort = vi.fn().mockResolvedValue({});
    const opencode = { session: { abort } } as never;
    let sessionId: string | undefined = "ses_ACTIVE";

    runInactivityTimeout({
      opencode,
      ws,
      getSessionId: () => sessionId,
      setSessionId: (id) => {
        sessionId = id;
      },
    });

    // WS に error が流れる(editor ChatPanel の case "error" を再利用するため)
    expect(sent).toHaveLength(1);
    expect((sent[0] as { type: string }).type).toBe("error");
    expect((sent[0] as { message: string }).message).toContain("3 分間");

    // abort が呼ばれる
    expect(abort).toHaveBeenCalledOnce();
    expect(abort.mock.calls[0][0]).toEqual({ path: { id: "ses_ACTIVE" } });

    // sessionId が undefined に
    expect(sessionId).toBeUndefined();
  });

  it("sessionId 未設定なら abort を呼ばない", () => {
    const ws = { send: vi.fn() };
    const abort = vi.fn();
    const opencode = { session: { abort } } as never;

    runInactivityTimeout({
      opencode,
      ws,
      getSessionId: () => undefined,
      setSessionId: () => {},
    });

    expect(abort).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledOnce(); // error 通知は出す
  });
});

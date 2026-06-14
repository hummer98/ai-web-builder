import { describe, it, expect, vi, afterEach } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { WebSocket as NodeWs } from "ws";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";

// site-init のモックは registerWsHandler import より前に定義する必要がある
const createNewSiteMock = vi.fn();
const importExistingRepoMock = vi.fn();
const resetWorkspaceMock = vi.fn();
vi.mock("./site-init.js", () => ({
  createNewSite: (...args: unknown[]) => createNewSiteMock(...args),
  importExistingRepo: (...args: unknown[]) => importExistingRepoMock(...args),
  resetWorkspace: (...args: unknown[]) => resetWorkspaceMock(...args),
}));

// supervisor.isRestarting のモック (デフォルト false)
const isRestartingMock = vi.fn(() => false);
vi.mock("./opencode-supervisor.js", () => ({
  isRestarting: () => isRestartingMock(),
}));

// ws-clients.add/removeClient のスパイ
const addClientMock = vi.fn();
const removeClientMock = vi.fn();
vi.mock("./ws-clients.js", () => ({
  addClient: (...args: unknown[]) => addClientMock(...args),
  removeClient: (...args: unknown[]) => removeClientMock(...args),
  broadcastSystem: vi.fn(),
}));

import { registerWsHandler } from "./ws-handler.js";

type FakeOpencode = {
  session: {
    create: ReturnType<typeof vi.fn>;
    promptAsync: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
  event: { subscribe: ReturnType<typeof vi.fn> };
};

type StartedServer = { server: ServerType; port: number };

async function startServer(
  opencode: FakeOpencode,
  inactivityTimeoutMs: number
): Promise<StartedServer> {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  registerWsHandler(app, upgradeWebSocket, {
    opencode: opencode as never,
    opencodeUrl: "http://opencode.test",
    inactivityTimeoutMs,
    workspaceDir: "/tmp/__aiwb_test_workspace__",
    siteDomain: "test-site",
  });

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => {
      resolve(s);
    });
  });

  injectWebSocket(server);

  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  const port = (addr as AddressInfo).port;
  return { server, port };
}

function createFakeOpencode(
  opts: { onReady?: (push: (ev: unknown) => void) => void } = {},
  overrides: { sessionId?: string } = {}
): FakeOpencode {
  const queue: unknown[] = [];
  let resolveNext: ((v: IteratorResult<unknown>) => void) | null = null;
  let closed = false;

  const push = (ev: unknown) => {
    if (closed) return;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: ev, done: false });
    } else {
      queue.push(ev);
    }
  };

  push({ type: "server.connected" });
  opts.onReady?.(push);

  async function* gen(): AsyncGenerator<unknown> {
    try {
      while (!closed) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        const ev = await new Promise<IteratorResult<unknown>>((r) => {
          resolveNext = r;
        });
        if (ev.done) return;
        yield ev.value;
      }
    } finally {
      closed = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined, done: true });
      }
    }
  }

  const stream = gen();

  return {
    session: {
      create: vi
        .fn()
        .mockResolvedValue({ data: { id: overrides.sessionId ?? "ses_TEST" } }),
      promptAsync: vi.fn().mockResolvedValue({}),
      abort: vi.fn().mockResolvedValue({}),
    },
    event: {
      subscribe: vi.fn().mockResolvedValue({ stream }),
    },
  };
}

async function closeServer(server: ServerType) {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
}

describe("registerWsHandler (WS integration)", () => {
  let started: StartedServer | undefined;

  afterEach(async () => {
    if (started) {
      await closeServer(started.server);
      started = undefined;
    }
    createNewSiteMock.mockReset();
    importExistingRepoMock.mockReset();
    resetWorkspaceMock.mockReset();
    isRestartingMock.mockReset();
    isRestartingMock.mockReturnValue(false);
    addClientMock.mockReset();
    removeClientMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("inactivityTimeoutMs 経過で timeout エラーメッセージが WS に届く", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 200);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(JSON.stringify({ type: "chat", message: "テスト" }));

    // 200ms timeout + 500ms buffer
    await new Promise((r) => setTimeout(r, 700));

    ws.close();

    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain("3 分間");
  });

  it("inactivity 発火で opencode.session.abort が {path:{id: sessionId}} で呼ばれる", async () => {
    const opencode = createFakeOpencode({}, { sessionId: "ses_TEST_010" });
    started = await startServer(opencode, 200);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ type: "chat", message: "テスト" }));
    await new Promise((r) => setTimeout(r, 700));
    ws.close();

    expect(opencode.session.abort).toHaveBeenCalledOnce();
    expect(opencode.session.abort).toHaveBeenCalledWith({
      path: { id: "ses_TEST_010" },
    });
  });

  it("不正 JSON を受信しても接続が落ちず error が返る", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send("not-json");
    // しばらく待って次の正常メッセージで接続生存確認
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).toBe(NodeWs.OPEN);

    ws.close();

    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
    expect(err!.message).toBe("Invalid message");
  });

  it("未知の type を受信しても接続維持で error が返る", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(JSON.stringify({ type: "unknown" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).toBe(NodeWs.OPEN);

    ws.close();

    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
    expect(err!.message).toBe("Invalid message");
  });

  it("history.count 範囲外でスキーマ違反 (error 返信)", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(JSON.stringify({ type: "history", count: 999 }));
    await new Promise((r) => setTimeout(r, 100));
    ws.close();

    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
    // 履歴メッセージは返ってきていないこと
    const hist = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "history"
    );
    expect(hist).toBeUndefined();
  });

  it("create-site: クライアントの owner は無視され、env GITHUB_OWNER が使われる", async () => {
    vi.stubEnv("GITHUB_OWNER", "trusted-owner");
    createNewSiteMock.mockResolvedValue({
      success: true,
      workspacePath: "/tmp/x",
      repoUrl: "https://github.com/trusted-owner/ok-name",
    });

    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(
      JSON.stringify({
        type: "create-site",
        owner: "attacker",
        siteName: "ok-name",
      })
    );
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    expect(createNewSiteMock).toHaveBeenCalledTimes(1);
    expect(createNewSiteMock).toHaveBeenCalledWith("trusted-owner", "ok-name");
  });

  it("create-site: siteName が path traversal だとスキーマで弾かれる", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(
      JSON.stringify({
        type: "create-site",
        siteName: "../evil",
      })
    );
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    expect(createNewSiteMock).not.toHaveBeenCalled();
    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
  });

  it("import-repo: クライアントの owner は無視される", async () => {
    vi.stubEnv("GITHUB_OWNER", "trusted-owner");
    importExistingRepoMock.mockResolvedValue({
      success: true,
      workspacePath: "/tmp/x",
      repoUrl: "https://github.com/trusted-owner/repo",
    });

    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(
      JSON.stringify({
        type: "import-repo",
        owner: "attacker",
        repoName: "my-repo",
      })
    );
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    expect(importExistingRepoMock).toHaveBeenCalledTimes(1);
    expect(importExistingRepoMock).toHaveBeenCalledWith(
      "trusted-owner",
      "my-repo"
    );
  });

  it("revert.hash が非 16 進だとスキーマ違反 (error 返信)", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(JSON.stringify({ type: "revert", hash: "NOT-HEX" }));
    await new Promise((r) => setTimeout(r, 100));
    ws.close();

    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
  });

  it("delta が継続して流れる間は timeout が発火しない", async () => {
    let pushDelta: ((ev: unknown) => void) | undefined;
    const opencode = createFakeOpencode(
      {
        onReady: (pusher) => {
          pushDelta = pusher;
        },
      },
      { sessionId: "ses_DELTA" }
    );
    started = await startServer(opencode, 300);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(JSON.stringify({ type: "chat", message: "テスト" }));

    // 100ms ごとに副作用のない message.part.updated (text part) を流す
    // timeout=300ms より短い間隔で reset が連続する → 600ms 経過でも timeout 非到達
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 100));
      pushDelta!({
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_DELTA",
            type: "text",
            text: `delta-${i}`,
          },
        },
      });
    }

    ws.close();

    const err = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeUndefined();
    expect(opencode.session.abort).not.toHaveBeenCalled();
  });

  it("onOpen で addClient が、onClose で removeClient が呼ばれる", async () => {
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);
    // 前テストからの遅延 close イベントを呑み込んでからカウントをリセット
    await new Promise((r) => setTimeout(r, 200));
    addClientMock.mockClear();
    removeClientMock.mockClear();

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    await new Promise((r) => setTimeout(r, 50));
    expect(addClientMock).toHaveBeenCalledTimes(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(removeClientMock).toHaveBeenCalledTimes(1);
  });

  it("isRestarting=true のとき chat は再起動メッセージを返し handler が走らない", async () => {
    isRestartingMock.mockReturnValue(true);
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(JSON.stringify({ type: "chat", message: "やあ" }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    const err = messages.find(
      (m): m is { type: string; message: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "error"
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain("設定を反映しています");
    expect(opencode.session.create).not.toHaveBeenCalled();
    expect(opencode.session.promptAsync).not.toHaveBeenCalled();
  });

  it("question.asked イベントを受けると editor に question メッセージを転送する", async () => {
    let push: ((ev: unknown) => void) | undefined;
    const opencode = createFakeOpencode(
      {
        onReady: (pusher) => {
          push = pusher;
        },
      },
      { sessionId: "ses_Q1" }
    );
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));

    // chat で session を確立 (sessionId がセットされないと handleEvent が走らない)
    ws.send(JSON.stringify({ type: "chat", message: "画面が真っ黒" }));
    await new Promise((r) => setTimeout(r, 100));

    push!({
      type: "question.asked",
      properties: {
        id: "que_ABC",
        sessionID: "ses_Q1",
        questions: [
          {
            question: "背景画像をどうしますか？",
            header: "背景画像",
            options: [
              { label: "AIで生成", description: "自動で作る" },
              { label: "今はやめる", description: "後で決める" },
            ],
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 100));
    ws.close();

    const q = messages.find(
      (m): m is { type: string; requestId: string; questions: unknown[] } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "question"
    );
    expect(q).toBeDefined();
    expect(q!.requestId).toBe("que_ABC");
    expect(q!.questions).toHaveLength(1);
  });

  it("answer メッセージで /question/{id}/reply に POST する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));

    ws.send(
      JSON.stringify({
        type: "answer",
        requestId: "que_XYZ",
        answers: [["AIで生成"]],
      })
    );
    await new Promise((r) => setTimeout(r, 150));
    ws.close();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://opencode.test/question/que_XYZ/reply");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      answers: [["AIで生成"]],
    });

    vi.unstubAllGlobals();
  });

  it("isRestarting=true で undo / deploy / revert もブロックされる", async () => {
    isRestartingMock.mockReturnValue(true);
    const opencode = createFakeOpencode();
    started = await startServer(opencode, 30000);

    for (const msg of [
      { type: "undo" },
      { type: "deploy" },
      { type: "revert", hash: "abcdef1" },
    ]) {
      const ws = new NodeWs(`ws://127.0.0.1:${started.port}/ws`);
      const messages: unknown[] = [];
      ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
      await new Promise<void>((r) => ws.on("open", () => r()));
      ws.send(JSON.stringify(msg));
      await new Promise((r) => setTimeout(r, 150));
      ws.close();
      const err = messages.find(
        (m): m is { type: string; message: string } =>
          typeof m === "object" &&
          m !== null &&
          (m as { type: string }).type === "error"
      );
      expect(err, `block expected for ${msg.type}`).toBeDefined();
      expect(err!.message).toContain("設定を反映しています");
    }
  });
});

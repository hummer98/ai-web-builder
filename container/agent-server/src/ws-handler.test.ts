import { describe, it, expect, vi, afterEach } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { WebSocket as NodeWs } from "ws";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";
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
});

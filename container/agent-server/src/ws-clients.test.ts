import { describe, it, expect, beforeEach, vi } from "vitest";
import { addClient, removeClient, broadcastSystem } from "./ws-clients.js";

type FakeWs = { send: ReturnType<typeof vi.fn> };

function makeWs(): FakeWs {
  return { send: vi.fn() };
}

describe("ws-clients", () => {
  beforeEach(() => {
    // 残留クライアントを掃除（モジュール状態のためテスト間で残る）
    // remove 全件: broadcast 経由で回収できるよう noop ws を除外する
    // ここではテスト内で local な ws のみ add するので afterEach で remove する代わりに
    // 各テスト最後に明示 removeClient する
  });

  it("addClient / broadcastSystem で全クライアントの send が呼ばれる", () => {
    const a = makeWs();
    const b = makeWs();
    addClient(a);
    addClient(b);
    broadcastSystem("opencode_restarting");
    const expected = JSON.stringify({
      type: "system",
      event: "opencode_restarting",
    });
    expect(a.send).toHaveBeenCalledWith(expected);
    expect(b.send).toHaveBeenCalledWith(expected);
    removeClient(a);
    removeClient(b);
  });

  it("removeClient 後は broadcastSystem で send されない", () => {
    const a = makeWs();
    addClient(a);
    removeClient(a);
    broadcastSystem("opencode_ready");
    expect(a.send).not.toHaveBeenCalled();
  });

  it("opencode_ready イベントも broadcast 可能", () => {
    const a = makeWs();
    addClient(a);
    broadcastSystem("opencode_ready");
    expect(a.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "system", event: "opencode_ready" })
    );
    removeClient(a);
  });

  it("send が throw しても他クライアントへの送信は止まらない", () => {
    const failing: FakeWs = {
      send: vi.fn(() => {
        throw new Error("connection closed");
      }),
    };
    const ok = makeWs();
    addClient(failing);
    addClient(ok);
    expect(() => broadcastSystem("opencode_restarting")).not.toThrow();
    expect(ok.send).toHaveBeenCalled();
    removeClient(failing);
    removeClient(ok);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInactivityTimer } from "./timeout.js";

describe("createInactivityTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("180 秒イベントなしで onTimeout が 1 度だけ呼ばれる", () => {
    const onTimeout = vi.fn();
    const timer = createInactivityTimer(180_000, onTimeout);
    timer.reset();

    vi.advanceTimersByTime(179_999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("reset を挟むと発火が後ろにずれる (179s → reset → 179s で未発火、さらに 1s で発火)", () => {
    const onTimeout = vi.fn();
    const timer = createInactivityTimer(180_000, onTimeout);
    timer.reset();

    vi.advanceTimersByTime(179_000);
    timer.reset();
    vi.advanceTimersByTime(179_000);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("stop 後は 200s 進めても発火しない", () => {
    const onTimeout = vi.fn();
    const timer = createInactivityTimer(180_000, onTimeout);
    timer.reset();
    timer.stop();

    vi.advanceTimersByTime(200_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("reset を複数回呼んでも重複発火しない (古い setTimeout が clear される)", () => {
    const onTimeout = vi.fn();
    const timer = createInactivityTimer(180_000, onTimeout);
    timer.reset();
    timer.reset();
    timer.reset();

    vi.advanceTimersByTime(200_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("timers 注入で fake timer なしでも動く (依存注入 API)", () => {
    const onTimeout = vi.fn();
    let pendingCb: (() => void) | null = null;
    let cleared = false;
    const timers = {
      setTimeout: ((cb: () => void) => {
        pendingCb = cb;
        return 42 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeout: ((_id: NodeJS.Timeout) => {
        cleared = true;
      }) as typeof clearTimeout,
    };
    const timer = createInactivityTimer(180_000, onTimeout, timers);
    timer.reset();
    expect(pendingCb).not.toBeNull();

    // 擬似発火
    pendingCb!();
    expect(onTimeout).toHaveBeenCalledOnce();

    // stop は何も起きないまま呼ぶケース
    timer.stop();
    expect(cleared).toBe(false); // 既に発火済みなので pending は null

    // 再度 reset → stop で clear が呼ばれる
    timer.reset();
    timer.stop();
    expect(cleared).toBe(true);
  });
});

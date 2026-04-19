export type TimerApi = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

export type InactivityTimer = {
  /** タイマーを張り直す。既存のタイマーがあれば clear してから新規 setTimeout を登録 */
  reset: () => void;
  /** タイマーを停止する。発火前なら onTimeout は呼ばれなくなる */
  stop: () => void;
};

/**
 * SSE イベント無アクティビティを検知する単純なタイマー。
 *
 * opencode の `promptAsync` から最後の SSE イベント到達までのインターバルが
 * `ms` を超えたら `onTimeout` を呼ぶ用途で使う。テストでは `timers` に
 * fake 実装を注入して `vi.advanceTimersByTime` を使う。
 */
export function createInactivityTimer(
  ms: number,
  onTimeout: () => void,
  timers: TimerApi = { setTimeout, clearTimeout }
): InactivityTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;

  const clearCurrent = () => {
    if (handle !== null) {
      timers.clearTimeout(handle);
      handle = null;
    }
  };

  return {
    reset() {
      clearCurrent();
      handle = timers.setTimeout(() => {
        handle = null;
        onTimeout();
      }, ms);
    },
    stop() {
      clearCurrent();
    },
  };
}

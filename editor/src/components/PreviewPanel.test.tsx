// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PreviewPanel from "./PreviewPanel";

// `import.meta.env.DEV` は vitest 上では true なので、PreviewPanel 側の
// PREVIEW_URL = "http://localhost:5173" / PREVIEW_ORIGIN = "http://localhost:5173"
// が DEV ブランチで使われる前提でテストする。
const PREVIEW_ORIGIN = "http://localhost:5173";

function dispatchNav(url: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "nav", url },
        origin: PREVIEW_ORIGIN,
      }),
    );
  });
}

function getIframe() {
  return screen.getByTitle("Site Preview") as HTMLIFrameElement;
}
function getBackBtn() {
  return screen.getByLabelText("戻る") as HTMLButtonElement;
}
function getForwardBtn() {
  return screen.getByLabelText("進む") as HTMLButtonElement;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PreviewPanel ナビゲーション (T024)", () => {
  it("← / → クリック時に親 window.history.back/forward を呼ばない", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const backSpy = vi.spyOn(window.history, "back");
    const forwardSpy = vi.spyOn(window.history, "forward");
    render(<PreviewPanel />);

    // 戻る/進む ボタンをクリック (履歴が無くても親 window の history は触らない)
    await user.click(getBackBtn());
    await user.click(getForwardBtn());

    expect(backSpy).not.toHaveBeenCalled();
    expect(forwardSpy).not.toHaveBeenCalled();
  });

  it("nav 2 件を受信 → ← で iframe.src が 1 件目の URL に書き換わる", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PreviewPanel />);

    const url1 = "http://localhost:5173/page1";
    const url2 = "http://localhost:5173/page2";
    dispatchNav(url1);
    dispatchNav(url2);

    await user.click(getBackBtn());

    expect(getIframe().src).toBe(url1);
  });

  it("nav 2 件 + ← の後に → を押すと iframe.src が 2 件目に戻る", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PreviewPanel />);

    const url1 = "http://localhost:5173/page1";
    const url2 = "http://localhost:5173/page2";
    dispatchNav(url1);
    dispatchNav(url2);

    await user.click(getBackBtn());
    await user.click(getForwardBtn());

    expect(getIframe().src).toBe(url2);
  });

  it("先頭にいるとき ← は disabled、末尾にいるとき → は disabled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PreviewPanel />);

    // 初期 (履歴 0 件): ← も → も disabled
    expect(getBackBtn().disabled).toBe(true);
    expect(getForwardBtn().disabled).toBe(true);

    dispatchNav("http://localhost:5173/page1");
    dispatchNav("http://localhost:5173/page2");
    dispatchNav("http://localhost:5173/page3");

    // 末尾: ← 有効 / → disabled
    expect(getBackBtn().disabled).toBe(false);
    expect(getForwardBtn().disabled).toBe(true);

    await user.click(getBackBtn());

    // 中間: ← / → 両方有効
    expect(getBackBtn().disabled).toBe(false);
    expect(getForwardBtn().disabled).toBe(false);

    await user.click(getBackBtn());

    // 先頭: ← disabled / → 有効
    expect(getBackBtn().disabled).toBe(true);
    expect(getForwardBtn().disabled).toBe(false);
  });

  it("← 押下後に届く同 URL の nav はスタックに積まれない (programmatic ignore)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PreviewPanel />);

    const url1 = "http://localhost:5173/page1";
    const url2 = "http://localhost:5173/page2";
    dispatchNav(url1);
    dispatchNav(url2);

    // ← で 1 件目に戻る (内部で iframe.src = url1 を仕掛け、programmaticUrlRef に url1 を入れる)
    await user.click(getBackBtn());
    // iframe 側からの nav が url1 で届く想定 → 本来なら push されるが programmatic として吸収されるべき
    dispatchNav(url1);

    // → で 2 件目に進めることを確認 (programmatic ignore が機能していれば stack は壊れていない)
    expect(getForwardBtn().disabled).toBe(false);
    await user.click(getForwardBtn());
    expect(getIframe().src).toBe(url2);
  });

  it("同一 URL を連続で nav 受信してもスタックに重複しない", () => {
    render(<PreviewPanel />);

    const url1 = "http://localhost:5173/page1";
    dispatchNav(url1);
    dispatchNav(url1);
    dispatchNav(url1);

    // 1 件しか積まれていなければ ← / → どちらも disabled (唯一の要素なので両端)
    expect(getBackBtn().disabled).toBe(true);
    expect(getForwardBtn().disabled).toBe(true);
  });
});

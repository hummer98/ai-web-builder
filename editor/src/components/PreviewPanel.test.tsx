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

// T025 テスト用ヘルパー
function renderPreview(overrides: Partial<React.ComponentProps<typeof PreviewPanel>> = {}) {
  const onOpenSiteBrief = vi.fn();
  const onOpenSettings = vi.fn();
  const onOpenHelp = vi.fn();
  const onOpenHistory = vi.fn();
  const onUndo = vi.fn();
  const onDeploy = vi.fn();
  const utils = render(
    <PreviewPanel
      connected={true}
      disabledReason={null}
      onOpenSiteBrief={onOpenSiteBrief}
      onOpenSettings={onOpenSettings}
      onOpenHelp={onOpenHelp}
      onOpenHistory={onOpenHistory}
      onUndo={onUndo}
      onDeploy={onDeploy}
      undoing={false}
      deploying={false}
      {...overrides}
    />,
  );
  return { ...utils, onOpenSiteBrief, onOpenSettings, onOpenHelp, onOpenHistory, onUndo, onDeploy };
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
    renderPreview();

    // 戻る/進む ボタンをクリック (履歴が無くても親 window の history は触らない)
    await user.click(getBackBtn());
    await user.click(getForwardBtn());

    expect(backSpy).not.toHaveBeenCalled();
    expect(forwardSpy).not.toHaveBeenCalled();
  });

  it("nav 2 件を受信 → ← で iframe.src が 1 件目の URL に書き換わる", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPreview();

    const url1 = "http://localhost:5173/page1";
    const url2 = "http://localhost:5173/page2";
    dispatchNav(url1);
    dispatchNav(url2);

    await user.click(getBackBtn());

    expect(getIframe().src).toBe(url1);
  });

  it("nav 2 件 + ← の後に → を押すと iframe.src が 2 件目に戻る", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPreview();

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
    renderPreview();

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
    renderPreview();

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
    renderPreview();

    const url1 = "http://localhost:5173/page1";
    dispatchNav(url1);
    dispatchNav(url1);
    dispatchNav(url1);

    // 1 件しか積まれていなければ ← / → どちらも disabled (唯一の要素なので両端)
    expect(getBackBtn().disabled).toBe(true);
    expect(getForwardBtn().disabled).toBe(true);
  });
});

describe("PreviewPanel ヘッダーボタン (T025)", () => {
  it("Reload ボタンは aria-label='再読み込み' でアイコン表示 (↻)", () => {
    renderPreview();
    const reloadBtn = screen.getByLabelText("再読み込み") as HTMLButtonElement;
    expect(reloadBtn).toBeTruthy();
    expect(reloadBtn.textContent).toContain("↻");
  });

  it("Reload ボタンクリックで iframe.contentWindow.location.reload を呼ぶ", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPreview();

    const iframe = getIframe();
    const reloadFn = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { location: { reload: reloadFn } },
      writable: true,
    });

    const reloadBtn = screen.getByLabelText("再読み込み");
    await user.click(reloadBtn);

    expect(reloadFn).toHaveBeenCalledTimes(1);
  });

  it("「サイト情報」クリック → onOpenSiteBrief 呼び出し", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenSiteBrief } = renderPreview();
    await user.click(screen.getByTitle("サイト情報を編集"));
    expect(onOpenSiteBrief).toHaveBeenCalledTimes(1);
  });

  it("「使い方」クリック → onOpenHelp 呼び出し", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenHelp } = renderPreview();
    await user.click(screen.getByTitle("使い方 (?)"));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("「設定」クリック → onOpenSettings 呼び出し", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenSettings } = renderPreview();
    await user.click(screen.getByLabelText("アクセスキーの設定"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("「履歴」クリック → onOpenHistory 呼び出し (connected=true, disabledReason=null)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenHistory } = renderPreview();
    await user.click(screen.getByTitle("変更履歴を表示"));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("「元に戻す」クリック → onUndo 呼び出し", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onUndo } = renderPreview();
    await user.click(screen.getByTitle("直前の変更を元に戻す"));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("「公開」クリック → onDeploy 呼び出し", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onDeploy } = renderPreview();
    await user.click(screen.getByRole("button", { name: "公開" }));
    expect(onDeploy).toHaveBeenCalledTimes(1);
  });

  it("disabledReason がある時、履歴/元に戻す/公開 が disabled", () => {
    renderPreview({ disabledReason: "テスト理由" });
    const historyBtn = screen.getByTitle("変更履歴を表示") as HTMLButtonElement;
    const undoBtn = screen.getByTitle("直前の変更を元に戻す") as HTMLButtonElement;
    const deployBtn = screen.getByRole("button", { name: "公開" }) as HTMLButtonElement;
    expect(historyBtn.disabled).toBe(true);
    expect(undoBtn.disabled).toBe(true);
    expect(deployBtn.disabled).toBe(true);
  });

  it("connected=false で 履歴/元に戻す/公開 が disabled", () => {
    renderPreview({ connected: false });
    const historyBtn = screen.getByTitle("変更履歴を表示") as HTMLButtonElement;
    const undoBtn = screen.getByTitle("直前の変更を元に戻す") as HTMLButtonElement;
    const deployBtn = screen.getByRole("button", { name: "公開" }) as HTMLButtonElement;
    expect(historyBtn.disabled).toBe(true);
    expect(undoBtn.disabled).toBe(true);
    expect(deployBtn.disabled).toBe(true);
  });

  it("undoing=true で「戻し中...」表示 + 元に戻すボタン disabled", () => {
    renderPreview({ undoing: true });
    expect(screen.getByText("戻し中...")).toBeTruthy();
    const undoBtn = screen.getByTitle("直前の変更を元に戻す") as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
  });

  it("deploying=true で「公開中...」表示 + 公開ボタン disabled", () => {
    renderPreview({ deploying: true });
    expect(screen.getByText("公開中...")).toBeTruthy();
    const deployBtn = screen.getByRole("button", { name: /公開中/ }) as HTMLButtonElement;
    expect(deployBtn.disabled).toBe(true);
  });

  it("公開ボタンは bg-emerald-600 クラスを保持", () => {
    renderPreview();
    const deployBtn = screen.getByRole("button", { name: "公開" });
    expect(deployBtn.className).toContain("bg-emerald-600");
  });

  it("公開ボタンは ml-auto クラスを持つ (右端配置)", () => {
    renderPreview();
    const deployBtn = screen.getByRole("button", { name: "公開" });
    expect(deployBtn.className).toContain("ml-auto");
  });

  it("Reload ボタンが 🏠 ボタンの直後にある (DOM 順序検証)", () => {
    renderPreview();
    const homeBtn = screen.getByLabelText("ホーム");
    const reloadBtn = screen.getByLabelText("再読み込み");
    // compareDocumentPosition: FOLLOWING(4) → reloadBtn が homeBtn の後にある
    expect(homeBtn.compareDocumentPosition(reloadBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // reloadBtn の直前の兄弟が homeBtn であること (隣接確認)
    expect(reloadBtn.previousElementSibling).toBe(homeBtn);
  });
});

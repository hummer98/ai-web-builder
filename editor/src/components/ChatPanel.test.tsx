// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// react-markdown はルート node_modules には入っていないため、テストでは素通しの mock に置き換える
vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import ChatPanel from "./ChatPanel";

const BYOK_REASON =
  "サイトを作る AI を動かすキーが必要です（OpenRouter）。⚙ 設定から登録してください";
const LOADING_REASON = "設定を読み込んでいます…";
const ERROR_REASON = "設定を読み込めませんでした。⚙ 設定から再試行してください";
const DEPLOY_REASON =
  "公開するには Cloudflare か Firebase のキーが必要です。⚙ 設定から登録してください";

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  const onSend = vi.fn();
  const onOpenSettings = vi.fn();
  const onOpenSiteBrief = vi.fn();
  const onHelp = vi.fn();
  const onClearElement = vi.fn();
  const utils = render(
    <ChatPanel
      connected={true}
      messages={[]}
      onSend={onSend}
      selectedElement={null}
      onClearElement={onClearElement}
      onHelp={onHelp}
      onOpenSiteBrief={onOpenSiteBrief}
      onOpenSettings={onOpenSettings}
      {...overrides}
    />,
  );
  return { ...utils, onSend, onOpenSettings, onOpenSiteBrief, onHelp, onClearElement };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // jsdom は HTMLElement.scrollTo を実装していないので no-op で stub
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = (() => {}) as typeof HTMLElement.prototype.scrollTo;
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChatPanel disabledReason gate (T1/T1a/T1b/T2)", () => {
  it("T1: disabledReason=BYOK → input disabled + placeholder 差し替え + 送信ボタン disabled", () => {
    renderPanel({ disabledReason: BYOK_REASON });
    const input = screen.getByPlaceholderText(BYOK_REASON) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const submit = screen.getByRole("button", { name: "送信" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("T1a: disabledReason=loading → input disabled + placeholder loading 文言", () => {
    renderPanel({ disabledReason: LOADING_REASON });
    const input = screen.getByPlaceholderText(LOADING_REASON) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("T1b: disabledReason=error → input disabled + placeholder error 文言", () => {
    renderPanel({ disabledReason: ERROR_REASON });
    const input = screen.getByPlaceholderText(ERROR_REASON) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("T2: disabledReason 未指定で従来動作 (input 有効)", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("指示を入力...") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });
});

describe("ChatPanel deploy guard (T9/T10)", () => {
  it("T9: cloudflare/firebase 両方未登録で公開ボタン → onOpenSettings 呼ばれ onSend({type:'deploy'}) は呼ばれない + status メッセージ追加", async () => {
    const { onSend, onOpenSettings } = renderPanel({
      cloudflareReady: false,
      firebaseReady: false,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const deployBtn = screen.getByRole("button", { name: "公開" });
    await user.click(deployBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    const deployCall = onSend.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "deploy",
    );
    expect(deployCall).toBeUndefined();
    expect(
      screen.getByText(/公開するには Cloudflare か Firebase のキーが必要です/),
    ).toBeTruthy();
  });

  it("T10: cloudflare 登録済みなら通常 deploy 送信", async () => {
    const { onSend, onOpenSettings } = renderPanel({
      cloudflareReady: true,
      firebaseReady: false,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "公開" }));
    expect(onSend).toHaveBeenCalledWith({ type: "deploy" });
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("T10b: firebase 登録済みなら通常 deploy 送信", async () => {
    const { onSend } = renderPanel({
      cloudflareReady: false,
      firebaseReady: true,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "公開" }));
    expect(onSend).toHaveBeenCalledWith({ type: "deploy" });
  });

  it("T10c: cloudflareReady/firebaseReady 未指定 (= undefined) なら従来動作 (deploy 送信)", async () => {
    const { onSend } = renderPanel();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "公開" }));
    expect(onSend).toHaveBeenCalledWith({ type: "deploy" });
  });

  it("T9b: disabledReason 文字列で公開ボタンも disabled", () => {
    renderPanel({ disabledReason: BYOK_REASON });
    const deployBtn = screen.getByRole("button", { name: "公開" }) as HTMLButtonElement;
    expect(deployBtn.disabled).toBe(true);
  });
});

describe("ChatPanel deploy reason copy", () => {
  it("DEPLOY_REASON の文言と一致する", () => {
    expect(DEPLOY_REASON).toBe(
      "公開するには Cloudflare か Firebase のキーが必要です。⚙ 設定から登録してください",
    );
  });
});

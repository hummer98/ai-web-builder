// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// react-markdown はルート node_modules には入っていないため、テストでは素通しの mock に置き換える
vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import ChatPanel from "./ChatPanel";

const BYOK_REASON =
  "サイトを作る AI を動かすキーが必要です（OpenRouter）。⚙ 設定から登録してください";
const LOADING_REASON = "設定を読み込んでいます…";
const ERROR_REASON = "設定を読み込めませんでした。⚙ 設定から再試行してください";

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  const onSend = vi.fn();
  const onClearElement = vi.fn();
  const utils = render(
    <ChatPanel
      connected={true}
      messages={[]}
      onSend={onSend}
      selectedElement={null}
      onClearElement={onClearElement}
      {...overrides}
    />,
  );
  return { ...utils, onSend, onClearElement };
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

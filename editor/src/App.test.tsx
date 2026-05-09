// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SecretStatus } from "./types/secrets";

// react-markdown / PreviewPanel / SiteBrief 系は jsdom テストでは重いので素通しに置き換える
vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./components/PreviewPanel", () => ({
  default: ({ onOpenSettings }: { onOpenSettings?: () => void }) => (
    <div data-testid="preview-panel-stub">
      <button aria-label="アクセスキーの設定" onClick={onOpenSettings}>設定</button>
    </div>
  ),
}));

vi.mock("./components/SiteBriefModal", () => ({
  default: () => null,
}));

vi.mock("./components/SiteBriefMiniModal", () => ({
  default: () => null,
}));

// WebSocket は hook ごとモック化 (jsdom 上で実 WS を開くと不安定)
vi.mock("./hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    connected: true,
    messages: [],
    send: vi.fn(),
  }),
}));

import App from "./App";

const STATUS_EMPTY: SecretStatus = {
  openrouter: { set: false },
  gemini: { set: false },
  cloudflare: { set: false },
  firebase: { set: false },
};

const STATUS_OR_SET: SecretStatus = {
  openrouter: { set: true, last4: "abcd" },
  gemini: { set: false },
  cloudflare: { set: false },
  firebase: { set: false },
};

const STATUS_OR_AND_GEMINI_SET: SecretStatus = {
  openrouter: { set: true, last4: "abcd" },
  gemini: { set: true, last4: "wxyz" },
  cloudflare: { set: false },
  firebase: { set: false },
};

type MockResponse = { body: unknown; status?: number };

function installFetchSequence(responses: MockResponse[]) {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  globalThis.fetch = fn;
  return fn;
}

const BYOK_REASON =
  "サイトを作る AI を動かすキーが必要です（OpenRouter）。⚙ 設定から登録してください";
const GEMINI_NOTICE =
  "画像を作る機能を使うには「Gemini」のキーが必要です（任意）";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = (() => {}) as typeof HTMLElement.prototype.scrollTo;
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("App BYOK auto-open + disabled (T3/T3b/T4)", () => {
  it("T3: openrouter.set=false で SettingsDialog が自動表示", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }, { body: STATUS_EMPTY }]);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("T3b: openrouter.set=false で ChatPanel input が disabled + placeholder が BYOK 案内", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }, { body: STATUS_EMPTY }]);
    render(<App />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText(BYOK_REASON) as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });
  });

  it("T4: openrouter.set=true で SettingsDialog 非表示", async () => {
    installFetchSequence([{ body: STATUS_OR_SET }]);
    render(<App />);
    // status を反映する時間を確保
    await waitFor(() => {
      const input = screen.getByPlaceholderText("指示を入力...") as HTMLInputElement;
      expect(input.disabled).toBe(false);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("App close transition refresh (T5)", () => {
  it("T5: 起動時 set=false で disabled → 保存 → close → refresh → set=true → 入力再有効化", async () => {
    // 1. mount-fetch (App.useSecrets refresh) → empty
    // 2. SettingsDialog open → useSecrets refresh → empty
    // 3. PUT /api/secrets → set=true (status updates inside SettingsDialog hook)
    // 4. close transition → App refresh → set=true
    installFetchSequence([
      { body: STATUS_EMPTY }, // 1: App mount
      { body: STATUS_EMPTY }, // 2: SettingsDialog open
      { body: STATUS_OR_SET }, // 3: PUT response
      { body: STATUS_OR_SET }, // 4: App close transition refresh
    ]);
    // confirm が呼ばれるケースを安全側に倒す (このテストでは dirty 解除済みであるべきだが、
    // jsdom の window.confirm は default で undefined を返すため fallback で true を返す)
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    // 起動時に dialog が auto-open
    await waitFor(() => screen.getByText("OpenRouter"));

    // input が disabled
    const input = screen.getByPlaceholderText(BYOK_REASON) as HTMLInputElement;
    expect(input.disabled).toBe(true);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);

    const orInput = (await screen.findAllByLabelText(
      "アクセスキー",
    ))[0] as HTMLInputElement;
    await user.type(orInput, "sk-test-1234");
    await user.click(screen.getByRole("button", { name: "保存" }));

    // ProviderCard が view モードに戻ったことを待つ (= dirty 解除済み)
    await waitFor(() =>
      expect(screen.queryByLabelText("アクセスキー")).toBeNull(),
    );

    // 「あとで設定する」を押して dialog を閉じる
    await user.click(screen.getByRole("button", { name: "あとで設定する" }));

    // close transition で App.refresh() が走り、set=true が反映される
    await waitFor(() => {
      const reEnabled = screen.getByPlaceholderText(
        "指示を入力...",
      ) as HTMLInputElement;
      expect(reEnabled.disabled).toBe(false);
    });
  });
});

describe("App gemini guard (T11/T11b/T11c)", () => {
  it("T11: gemini.set=false で起動 → ChatPanel に画像案内 status が 1 件 inject", async () => {
    installFetchSequence([{ body: STATUS_OR_SET }]);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(GEMINI_NOTICE)).toBeTruthy();
    });
  });

  it("T11b: gemini.set=true で起動 → 画像案内が inject されない", async () => {
    installFetchSequence([{ body: STATUS_OR_AND_GEMINI_SET }]);
    render(<App />);
    // 画面が描画されるまで待つ
    await waitFor(() => {
      const input = screen.getByPlaceholderText("指示を入力...") as HTMLInputElement;
      expect(input.disabled).toBe(false);
    });
    expect(screen.queryByText(GEMINI_NOTICE)).toBeNull();
  });

  it("T11c: gemini.set=false で dialog 開閉して refresh → 画像案内は再注入されない (1 件のまま)", async () => {
    // 1: App mount → OR set, gemini unset
    // 2: SettingsDialog open refresh → 同状態
    // 3: close transition refresh → 同状態
    installFetchSequence([
      { body: STATUS_OR_SET },
      { body: STATUS_OR_SET },
      { body: STATUS_OR_SET },
    ]);
    render(<App />);

    await waitFor(() => screen.getByText(GEMINI_NOTICE));
    expect(screen.getAllByText(GEMINI_NOTICE)).toHaveLength(1);

    // 設定を開いて閉じる (refresh トリガー)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(
      screen.getByRole("button", { name: "アクセスキーの設定" }),
    );
    await waitFor(() => screen.getByText("OpenRouter"));
    // mandatory ではないので Esc で閉じられる
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("OpenRouter")).toBeNull(),
    );

    // 再注入されていない
    expect(screen.getAllByText(GEMINI_NOTICE)).toHaveLength(1);
  });
});

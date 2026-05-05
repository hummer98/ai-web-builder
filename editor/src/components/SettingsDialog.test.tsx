// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsDialog from "./SettingsDialog";
import type { SecretStatus } from "../types/secrets";

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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SettingsDialog", () => {
  it("renders 4 provider cards with title and provider id", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }]);
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));
    expect(screen.getByText("OpenRouter")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
    expect(screen.getByText("Cloudflare")).toBeTruthy();
    expect(screen.getByText("Firebase")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "settings-dialog-title",
    );
  });

  it("calls onClose on Escape when not dirty", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }]);
    const onClose = vi.fn();
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={onClose}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("expanding edit form via 変更 button reveals password input and autofocuses first field", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }]);
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // 各カード「変更」ボタンが複数ある — OpenRouter カードの変更を押す
    const buttons = screen.getAllByRole("button", { name: "変更" });
    await user.click(buttons[0]);

    const inputs = await screen.findAllByLabelText("アクセスキー");
    const orInput = inputs[0] as HTMLInputElement;
    expect(orInput.type).toBe("password");
    expect(orInput.getAttribute("autocomplete")).toBe("off");
    expect(orInput.getAttribute("autocapitalize")).toBe("off");
    expect(orInput.getAttribute("spellcheck")).toBe("false");
    await waitFor(() => {
      expect(document.activeElement).toBe(orInput);
    });
  });

  it("save flow: PUT /api/secrets, status updates, input cleared, restart banner shown then dismissed", async () => {
    // mount-fetch + open-fetch + save = 3 calls expected
    const fetchMock = installFetchSequence([
      { body: STATUS_EMPTY },
      { body: STATUS_EMPTY },
      { body: STATUS_OR_SET },
    ]);
    render(
      <SettingsDialog
        open
        opencodeRestarting
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);

    const orInput = (await screen.findAllByLabelText(
      "アクセスキー",
    ))[0] as HTMLInputElement;
    await user.type(orInput, "sk-test-1234");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(screen.getByText(/AI を再起動しています/)).toBeTruthy(),
    );

    // status が更新されていれば末尾表示が出る
    await waitFor(() => screen.getByText(/末尾: ••••abcd/));

    // mount-fetch + open-fetch + PUT = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const putCall = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[2];
    expect(putCall[0]).toBe("/api/secrets");
    expect((putCall[1] as RequestInit).method).toBe("PUT");
    expect((putCall[1] as RequestInit).body).toBe(
      JSON.stringify({ openrouter: { apiKey: "sk-test-1234" } }),
    );

    // 編集モードから抜けて再度「変更」ボタンが表示されているはず → input は DOM 外
    await waitFor(() =>
      expect(screen.queryByLabelText("アクセスキー")).toBeNull(),
    );

    // タイマー fallback 経過でバナーが消える
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await waitFor(() =>
      expect(screen.queryByText(/AI を再起動しています/)).toBeNull(),
    );
  });

  it("delete flow shows confirmation UI then calls DELETE", async () => {
    // mount + open refresh + DELETE
    const fetchMock = installFetchSequence([
      { body: STATUS_OR_SET },
      { body: STATUS_OR_SET },
      { body: STATUS_EMPTY },
    ]);
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText(/末尾: ••••abcd/));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // 1回目クリック=確認 UI 展開、2回目=確定。getAllByRole で取り直す
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText("本当に削除しますか?")).toBeTruthy();

    const confirmButtons = screen.getAllByRole("button", { name: "削除" });
    // 確認ダイアログ展開後は赤ボタン (red-600) が確定ボタン
    const confirm = confirmButtons.find((b) =>
      (b as HTMLButtonElement).className.includes("bg-red-600"),
    );
    expect(confirm).toBeTruthy();
    await user.click(confirm!);

    await waitFor(() => {
      const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
        .calls;
      const deleteCall = calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCall).toBeTruthy();
      expect(deleteCall![0]).toBe("/api/secrets/openrouter");
    });
  });

  it("required validation shows inline error without calling API", async () => {
    const fetchMock = installFetchSequence([{ body: STATUS_EMPTY }]);
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("アクセスキーを入力してください")).toBeTruthy();
    // PUT が呼ばれていない（GET のみ）
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const nonGet = calls.filter(
      (c) =>
        (c[1] as RequestInit | undefined)?.method !== undefined &&
        (c[1] as RequestInit).method !== "GET",
    );
    expect(nonGet).toHaveLength(0);
  });

  it("error from API surfaces UX-translated text in banner", async () => {
    installFetchSequence([
      { body: STATUS_EMPTY },
      { body: STATUS_EMPTY },
      { body: { error: "invalid_request" }, status: 400 },
    ]);
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);
    const orInput = (await screen.findAllByLabelText(
      "アクセスキー",
    ))[0] as HTMLInputElement;
    await user.type(orInput, "x");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByText("保存に失敗しました")).toBeTruthy(),
    );
    // 生 enum 文字列は出ない
    expect(screen.queryByText(/invalid_request/)).toBeNull();
  });

  it("dirty 状態で Esc → confirm キャンセル → モーダル閉じない", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }]);
    const onClose = vi.fn();
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={onClose}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // 「変更」モードに切り替えて dirty 状態を作る
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);
    await waitFor(() => screen.getByRole("button", { name: "保存" }));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await user.keyboard("{Escape}");

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // モーダル本文がまだ DOM に残っている
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("dirty 状態で Esc → confirm OK → モーダル閉じる", async () => {
    installFetchSequence([{ body: STATUS_EMPTY }]);
    const onClose = vi.fn();
    render(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={onClose}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);
    await waitFor(() => screen.getByRole("button", { name: "保存" }));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    await user.keyboard("{Escape}");

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opencode_ready (restarting=false transition) clears restart banner", async () => {
    installFetchSequence([
      { body: STATUS_EMPTY },
      { body: STATUS_EMPTY },
      { body: STATUS_OR_SET },
    ]);
    const { rerender } = render(
      <SettingsDialog
        open
        opencodeRestarting
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("OpenRouter"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "変更" })[0]);
    const orInput = (await screen.findAllByLabelText(
      "アクセスキー",
    ))[0] as HTMLInputElement;
    await user.type(orInput, "x");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(screen.getByText(/AI を再起動しています/)).toBeTruthy(),
    );

    rerender(
      <SettingsDialog
        open
        opencodeRestarting={false}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByText(/AI を再起動しています/)).toBeNull(),
    );
  });
});

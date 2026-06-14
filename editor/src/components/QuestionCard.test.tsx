// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import QuestionCard, { isQuickSingle } from "./QuestionCard";
import type { QuestionItem } from "../types/ws-outbound";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const singleQuestion: QuestionItem[] = [
  {
    question: "背景画像をどうしますか？",
    header: "背景画像",
    options: [
      { label: "AIで生成", description: "自動で作る" },
      { label: "今はやめる", description: "後で決める" },
    ],
  },
];

describe("isQuickSingle", () => {
  it("単一問・単一選択・custom なしは true", () => {
    expect(isQuickSingle(singleQuestion)).toBe(true);
  });

  it("複数選択は false", () => {
    expect(
      isQuickSingle([{ ...singleQuestion[0], multiple: true }])
    ).toBe(false);
  });

  it("custom 許可は false", () => {
    expect(isQuickSingle([{ ...singleQuestion[0], custom: true }])).toBe(false);
  });

  it("2 問以上は false", () => {
    expect(isQuickSingle([singleQuestion[0], singleQuestion[0]])).toBe(false);
  });
});

describe("QuestionCard", () => {
  it("単一選択は選んだ瞬間に onAnswer が呼ばれる (送信ボタンなし)", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        pending={{ requestId: "que_1", questions: singleQuestion }}
        onAnswer={onAnswer}
      />
    );
    // quick single なので「これで進める」ボタンは無い
    expect(screen.queryByText("これで進める")).toBeNull();

    fireEvent.click(screen.getByText("AIで生成"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("que_1", [["AIで生成"]]);
  });

  it("二重クリックしても onAnswer は 1 度だけ", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        pending={{ requestId: "que_1", questions: singleQuestion }}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByText("AIで生成"));
    fireEvent.click(screen.getByText("今はやめる"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("複数選択はトグルして「これで進める」で確定する", () => {
    const onAnswer = vi.fn();
    const q: QuestionItem[] = [
      {
        question: "使う色を選んでください",
        header: "配色",
        multiple: true,
        options: [
          { label: "赤", description: "" },
          { label: "青", description: "" },
          { label: "緑", description: "" },
        ],
      },
    ];
    render(
      <QuestionCard
        pending={{ requestId: "que_2", questions: q }}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByText("赤"));
    fireEvent.click(screen.getByText("緑"));
    // 確定前は呼ばれない
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("これで進める"));
    expect(onAnswer).toHaveBeenCalledWith("que_2", [["赤", "緑"]]);
  });

  it("選択ゼロでは確定ボタンが disabled", () => {
    const onAnswer = vi.fn();
    const q: QuestionItem[] = [{ ...singleQuestion[0], multiple: true }];
    render(
      <QuestionCard
        pending={{ requestId: "que_3", questions: q }}
        onAnswer={onAnswer}
      />
    );
    const btn = screen.getByText("これで進める") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("custom 入力を追加して確定できる", () => {
    const onAnswer = vi.fn();
    const q: QuestionItem[] = [
      {
        question: "サイト名は？",
        header: "名前",
        custom: true,
        options: [{ label: "おまかせ", description: "" }],
      },
    ];
    render(
      <QuestionCard
        pending={{ requestId: "que_4", questions: q }}
        onAnswer={onAnswer}
      />
    );
    const input = screen.getByPlaceholderText("自由に入力...");
    fireEvent.change(input, { target: { value: "海辺のカフェ" } });
    fireEvent.click(screen.getByText("追加"));
    fireEvent.click(screen.getByText("これで進める"));
    expect(onAnswer).toHaveBeenCalledWith("que_4", [["海辺のカフェ"]]);
  });
});

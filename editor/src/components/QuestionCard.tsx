import { useState } from "react";
import type { QuestionItem } from "../types/ws-outbound";

export type PendingQuestion = {
  requestId: string;
  questions: QuestionItem[];
};

type Props = {
  pending: PendingQuestion;
  onAnswer: (requestId: string, answers: string[][]) => void;
};

/**
 * 単一問・単一選択・自由入力なし → ワンタップで確定できる最頻ケースか判定する。
 * (非エンジニア向けに「選んだら即進む」を優先)
 */
export function isQuickSingle(questions: QuestionItem[]): boolean {
  return (
    questions.length === 1 &&
    !questions[0].multiple &&
    !questions[0].custom
  );
}

/**
 * opencode の question ツールが出した選択肢をチャット内に表示し、
 * 回答を 1 度だけ送るカード。
 *
 * - 単一選択: ボタンを押すと選択 (最頻ケースは即送信)
 * - 複数選択: トグルして「送信」で確定
 * - custom (その他): 自由入力欄を表示
 */
export default function QuestionCard({ pending, onAnswer }: Props) {
  const { requestId, questions } = pending;
  // 質問ごとの選択ラベル配列
  const [selections, setSelections] = useState<string[][]>(
    questions.map(() => [])
  );
  const [customText, setCustomText] = useState<string[]>(
    questions.map(() => "")
  );
  const [submitted, setSubmitted] = useState(false);

  const quick = isQuickSingle(questions);

  const submit = (finalSelections: string[][]) => {
    if (submitted) return;
    setSubmitted(true);
    onAnswer(requestId, finalSelections);
  };

  const pickSingle = (qi: number, label: string) => {
    if (submitted) return;
    if (quick) {
      // 最頻ケース: 押した瞬間に確定
      submit([[label]]);
      return;
    }
    setSelections((prev) => {
      const next = prev.map((s) => [...s]);
      next[qi] = [label];
      return next;
    });
  };

  const toggleMulti = (qi: number, label: string) => {
    if (submitted) return;
    setSelections((prev) => {
      const next = prev.map((s) => [...s]);
      const cur = next[qi];
      next[qi] = cur.includes(label)
        ? cur.filter((l) => l !== label)
        : [...cur, label];
      return next;
    });
  };

  const addCustom = (qi: number) => {
    const text = customText[qi].trim();
    if (!text || submitted) return;
    const q = questions[qi];
    setSelections((prev) => {
      const next = prev.map((s) => [...s]);
      next[qi] = q.multiple ? [...next[qi], text] : [text];
      return next;
    });
    setCustomText((prev) => {
      const next = [...prev];
      next[qi] = "";
      return next;
    });
  };

  const canSubmit = selections.every((s) => s.length > 0);

  return (
    <div className="bg-gray-800 border border-blue-500/40 rounded-lg p-3 mr-8 space-y-3">
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide bg-blue-600/30 text-blue-200 rounded px-1.5 py-0.5">
              {q.header}
            </span>
          </div>
          <p className="text-sm text-gray-200">{q.question}</p>
          <div className="space-y-1.5">
            {q.options.map((opt) => {
              const selected = selections[qi].includes(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  disabled={submitted}
                  onClick={() =>
                    q.multiple
                      ? toggleMulti(qi, opt.label)
                      : pickSingle(qi, opt.label)
                  }
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm border transition-colors disabled:opacity-50 ${
                    selected
                      ? "bg-blue-600/30 border-blue-400 text-blue-100"
                      : "bg-gray-700/40 border-gray-600 text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="block text-xs text-gray-400 mt-0.5">
                      {opt.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {q.custom && (
            <div className="flex gap-2">
              <input
                type="text"
                value={customText[qi]}
                disabled={submitted}
                onChange={(e) =>
                  setCustomText((prev) => {
                    const next = [...prev];
                    next[qi] = e.target.value;
                    return next;
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom(qi);
                  }
                }}
                placeholder="自由に入力..."
                className="flex-1 bg-gray-900 text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={submitted || !customText[qi].trim()}
                onClick={() => addCustom(qi)}
                className="bg-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-600 disabled:opacity-50"
              >
                追加
              </button>
            </div>
          )}
          {selections[qi].length > 0 && (
            <p className="text-xs text-blue-300">
              選択中: {selections[qi].join(", ")}
            </p>
          )}
        </div>
      ))}

      {!quick && (
        <button
          type="button"
          disabled={submitted || !canSubmit}
          onClick={() => submit(selections)}
          className="w-full bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitted ? "送信しました" : "これで進める"}
        </button>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { parseSiteBrief, setWhatKind } from "../lib/site-brief";

type Props = {
  open: boolean;
  initialMarkdown: string;
  saving: boolean;
  onSkip: () => void;
  onSave: (markdown: string) => void;
  onOpenFull: () => void;
};

/**
 * サイト作成直後に「このサイトを 1 行で説明してください」を聞くミニモーダル。
 * - 1 textarea のみで離脱率を下げる狙い (MVP+)
 * - 「あとで詳しく書く」ボタンで 5 項目モーダルに繋ぐ
 * - 「スキップ」で閉じる (再表示は ChatPanel ヘッダーから)
 */
export default function SiteBriefMiniModal({
  open,
  initialMarkdown,
  saving,
  onSkip,
  onSave,
  onOpenFull,
}: Props) {
  const [value, setValue] = useState("");

  // 開くたびに既存の whatKind を初期値として復元
  useEffect(() => {
    if (open) {
      setValue(parseSiteBrief(initialMarkdown).whatKind);
    }
  }, [open, initialMarkdown]);

  if (!open) return null;

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      onSkip();
      return;
    }
    onSave(setWhatKind(initialMarkdown, trimmed));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-gray-800 text-gray-100 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-2">このサイトはどんな場所ですか?</h2>
        <p className="text-xs text-gray-400 mb-4">
          1 行で説明してください。AI がこの情報をもとにサイトを作ります。
          <br />
          あとで詳しく書き足せます。
        </p>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="例: 新宿区西新宿のフレンチカフェ"
          rows={2}
          autoFocus
          disabled={saving}
          className="w-full bg-gray-900 text-gray-100 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-500 resize-y"
        />

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={onOpenFull}
            disabled={saving}
            className="text-xs text-blue-400 hover:underline disabled:opacity-50"
          >
            詳しく書く →
          </button>
          <div className="flex gap-2">
            <button
              onClick={onSkip}
              disabled={saving}
              className="bg-gray-700 text-gray-300 rounded-lg px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50"
            >
              スキップ
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !value.trim()}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && (
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              保存して始める
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

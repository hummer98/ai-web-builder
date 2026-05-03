import { useEffect, useState } from "react";
import {
  EMPTY_FIELDS,
  parseSiteBrief,
  serializeSiteBrief,
  type SiteBriefFields,
} from "../lib/site-brief";

type Props = {
  open: boolean;
  initialMarkdown: string;
  saving: boolean;
  onClose: () => void;
  onSave: (markdown: string) => void;
};

const FIELD_LABELS: Array<{
  key: keyof SiteBriefFields;
  label: string;
  placeholder: string;
  rows: number;
}> = [
  {
    key: "whatKind",
    label: "🏪 何のサイト",
    placeholder: "例: 新宿区のカフェ「Café Lumière」",
    rows: 2,
  },
  {
    key: "location",
    label: "📍 場所",
    placeholder: "例: 東京都新宿区西新宿X-X-X (任意)",
    rows: 2,
  },
  {
    key: "audience",
    label: "👥 来てほしい人",
    placeholder: "例: 近所で働く 30 代女性 (任意)",
    rows: 2,
  },
  {
    key: "tone",
    label: "🎨 雰囲気・トーン",
    placeholder: "例: 柔らかく落ち着いた / モダンで都会的",
    rows: 2,
  },
  {
    key: "notes",
    label: "📝 大事なメモ",
    placeholder: "例: 全席禁煙、ランチ営業 11:30-14:00 (任意)",
    rows: 4,
  },
];

export default function SiteBriefModal({
  open,
  initialMarkdown,
  saving,
  onClose,
  onSave,
}: Props) {
  const [fields, setFields] = useState<SiteBriefFields>(EMPTY_FIELDS);

  // 開くたびに最新の markdown から fields を再構成
  useEffect(() => {
    if (open) {
      setFields(parseSiteBrief(initialMarkdown));
    }
  }, [open, initialMarkdown]);

  if (!open) return null;

  function update<K extends keyof SiteBriefFields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    onSave(serializeSiteBrief(fields));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 text-gray-100 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">サイト情報</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg leading-none"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4">
          ここに書いた情報は AI がサイトを編集するときに毎回参照します。
          全部書かなくても OK。あとから書き換えられます。
        </p>

        <div className="space-y-4">
          {FIELD_LABELS.map(({ key, label, placeholder, rows }) => (
            <div key={key}>
              <label
                htmlFor={`site-brief-${key}`}
                className="block text-sm font-medium mb-1"
              >
                {label}
              </label>
              <textarea
                id={`site-brief-${key}`}
                value={fields[key]}
                onChange={(e) => update(key, e.target.value)}
                placeholder={placeholder}
                rows={rows}
                disabled={saving}
                className="w-full bg-gray-900 text-gray-100 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-500 resize-y"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="bg-gray-700 text-gray-200 rounded-lg px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && (
              <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

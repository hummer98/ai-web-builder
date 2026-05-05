import { useEffect, useRef, useState } from "react";
import type { Provider } from "../types/secrets";

export type Field = {
  name: string;
  label: string;
  placeholder?: string;
};

export type ProviderCardStatus = {
  set: boolean;
  last4?: string;
  accountId?: string;
};

type Props = {
  provider: Provider;
  title: string;
  helpText: string;
  helpUrl: string;
  helpUrlLabel?: string;
  fields: Field[];
  status: ProviderCardStatus;
  saving: boolean;
  deleting: boolean;
  onSave: (values: Record<string, string>) => Promise<{ ok: boolean }>;
  onDelete: () => Promise<{ ok: boolean }>;
  onDirtyChange?: (dirty: boolean) => void;
};

const REQUIRED_LABEL_BY_NAME: Record<string, string> = {
  apiKey: "アクセスキーを入力してください",
  apiToken: "アクセスキーを入力してください",
  token: "アクセスキーを入力してください",
  accountId: "Account ID を入力してください",
};

function requiredMessage(field: Field): string {
  return (
    REQUIRED_LABEL_BY_NAME[field.name] ??
    `${field.label}を入力してください`
  );
}

export default function ProviderCard({
  provider,
  title,
  helpText,
  helpUrl,
  helpUrlLabel,
  fields,
  status,
  saving,
  deleting,
  onSave,
  onDelete,
  onDirtyChange,
}: Props) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // dirty 通知
  useEffect(() => {
    onDirtyChange?.(mode === "edit" || confirmingDelete);
  }, [mode, confirmingDelete, onDirtyChange]);

  // edit モード突入時に最初のフィールドへ focus
  useEffect(() => {
    if (mode === "edit") {
      firstInputRef.current?.focus();
    }
  }, [mode]);

  function startEdit() {
    const blank: Record<string, string> = {};
    for (const f of fields) blank[f.name] = "";
    setValues(blank);
    setErrors({});
    setMode("edit");
  }

  function cancelEdit() {
    setValues({});
    setErrors({});
    setMode("view");
  }

  async function handleSave() {
    const nextErrors: Record<string, string> = {};
    for (const f of fields) {
      const v = (values[f.name] ?? "").trim();
      if (!v) nextErrors[f.name] = requiredMessage(f);
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const trimmed: Record<string, string> = {};
    for (const f of fields) trimmed[f.name] = (values[f.name] ?? "").trim();

    const res = await onSave(trimmed);
    if (res.ok) {
      // セキュリティ: 平文 API キーを React state から即座にクリア
      setValues({});
      setErrors({});
      setMode("view");
    }
  }

  function startDelete() {
    setConfirmingDelete(true);
  }

  function cancelDelete() {
    setConfirmingDelete(false);
    if (Object.keys(values).length > 0) {
      setValues({});
    }
  }

  async function confirmDelete() {
    const res = await onDelete();
    if (res.ok) {
      setConfirmingDelete(false);
      setValues({});
    }
  }

  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="text-xs text-gray-500">{provider}</span>
      </div>
      <p className="text-xs text-gray-400 mb-1">{helpText}</p>
      <a
        href={helpUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-xs text-blue-400 hover:text-blue-300 underline break-all"
      >
        → {helpUrlLabel ?? helpUrl}
      </a>

      <div className="mt-3 text-xs text-gray-300">
        状態:{" "}
        {status.set ? (
          <span>
            {`登録済み（末尾: ••••${status.last4 ?? "????"}${
              status.accountId ? `, account: ${status.accountId}` : ""
            }）`}
          </span>
        ) : (
          <span className="text-gray-500">未登録</span>
        )}
      </div>

      {mode === "view" && !confirmingDelete && (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={startEdit}
            disabled={saving || deleting}
            className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            変更
          </button>
          {status.set && (
            <button
              type="button"
              onClick={startDelete}
              disabled={saving || deleting}
              className="bg-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-600 disabled:opacity-50"
            >
              削除
            </button>
          )}
        </div>
      )}

      {mode === "edit" && (
        <div className="mt-3 space-y-3">
          {fields.map((f, idx) => (
            <div key={f.name}>
              <label
                htmlFor={`secret-${provider}-${f.name}`}
                className="block text-xs font-medium mb-1"
              >
                {f.label}
              </label>
              <input
                id={`secret-${provider}-${f.name}`}
                ref={idx === 0 ? firstInputRef : undefined}
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={values[f.name] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                }
                placeholder={f.placeholder}
                disabled={saving}
                className="w-full bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-500"
              />
              {errors[f.name] && (
                <p className="text-xs text-red-400 mt-1">{errors[f.name]}</p>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && (
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              保存
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="bg-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-600 disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-300">本当に削除しますか?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-red-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-500 disabled:opacity-50 flex items-center gap-2"
            >
              {deleting && (
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              削除
            </button>
            <button
              type="button"
              onClick={cancelDelete}
              disabled={deleting}
              className="bg-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-600 disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import ProviderCard, {
  type Field,
  type ProviderCardStatus,
} from "./ProviderCard";
import { useSecrets } from "../hooks/useSecrets";
import type { Provider, SecretsUpdate } from "../types/secrets";

type Props = {
  open: boolean;
  opencodeRestarting: boolean;
  onClose: () => void;
  mandatory?: boolean;
};

const MANDATORY_BANNER =
  "サイトを作る AI を動かすキーが必要です（OpenRouter）。⚙ 設定から登録してください";

const RESTART_FALLBACK_MS = 3000;

type ProviderConfig = {
  provider: Provider;
  title: string;
  helpText: string;
  helpUrl: string;
  helpUrlLabel?: string;
  fields: Field[];
};

const PROVIDERS: ProviderConfig[] = [
  {
    provider: "openrouter",
    title: "OpenRouter",
    helpText: "サイトを作る AI を動かすキー",
    helpUrl: "https://openrouter.ai/keys",
    helpUrlLabel: "openrouter.ai/keys で取得",
    fields: [{ name: "apiKey", label: "アクセスキー" }],
  },
  {
    provider: "gemini",
    title: "Gemini",
    helpText: "画像を作るキー（任意）",
    helpUrl: "https://aistudio.google.com/app/apikey",
    helpUrlLabel: "aistudio.google.com/app/apikey で取得",
    fields: [{ name: "apiKey", label: "アクセスキー" }],
  },
  {
    provider: "cloudflare",
    title: "Cloudflare",
    helpText: "公開先（Cloudflare）に出すためのキー",
    helpUrl: "https://dash.cloudflare.com/profile/api-tokens",
    helpUrlLabel: "dash.cloudflare.com/profile/api-tokens で取得",
    fields: [
      { name: "apiToken", label: "API Token" },
      { name: "accountId", label: "Account ID" },
    ],
  },
  {
    provider: "firebase",
    title: "Firebase",
    helpText: "公開先（Firebase）に出すためのキー",
    helpUrl: "https://firebase.google.com/docs/cli#cli-ci-systems",
    helpUrlLabel: "取得手順を見る",
    fields: [{ name: "token", label: "トークン" }],
  },
];

const RESTART_PROVIDERS = new Set<Provider>(["openrouter", "gemini"]);

function buildUpdate(
  provider: Provider,
  values: Record<string, string>,
): SecretsUpdate {
  switch (provider) {
    case "openrouter":
      return { openrouter: { apiKey: values.apiKey } };
    case "gemini":
      return { gemini: { apiKey: values.apiKey } };
    case "cloudflare":
      return {
        cloudflare: {
          apiToken: values.apiToken,
          accountId: values.accountId,
        },
      };
    case "firebase":
      return { firebase: { token: values.token } };
  }
}

export default function SettingsDialog({
  open,
  opencodeRestarting,
  onClose,
  mandatory = false,
}: Props) {
  const { status, loading, saving, deleting, error, refresh, save, remove } =
    useSecrets();
  const [restartingTimerActive, setRestartingTimerActive] = useState<
    Set<Provider>
  >(() => new Set());
  const [dirtyProviders, setDirtyProviders] = useState<Set<Provider>>(
    () => new Set(),
  );
  const opencodeRestartingRef = useRef(opencodeRestarting);

  useEffect(() => {
    opencodeRestartingRef.current = opencodeRestarting;
  }, [opencodeRestarting]);

  const dirty = dirtyProviders.size > 0;

  // 開いた瞬間に refresh
  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  // WS で restart が完了 (=false) になったら、残っているタイマー対象を即クリア
  useEffect(() => {
    if (!opencodeRestarting && restartingTimerActive.size > 0) {
      setRestartingTimerActive(new Set());
    }
    // restartingTimerActive を deps に入れると無限ループになるため除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opencodeRestarting]);

  const closeWithDirtyCheck = useCallback(() => {
    if (dirty) {
      const ok = window.confirm("未保存の変更があります。閉じますか?");
      if (!ok) return;
    }
    setDirtyProviders(new Set());
    onClose();
  }, [dirty, onClose]);

  // Esc / 背景クリックの暗黙 close — mandatory 中は no-op
  const tryAutoClose = useCallback(() => {
    if (mandatory) return;
    closeWithDirtyCheck();
  }, [mandatory, closeWithDirtyCheck]);

  // Esc 処理
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        tryAutoClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, tryAutoClose]);

  const handleProviderDirty = useCallback(
    (provider: Provider, isDirty: boolean) => {
      setDirtyProviders((prev) => {
        const wasIn = prev.has(provider);
        if (isDirty === wasIn) return prev;
        const next = new Set(prev);
        if (isDirty) next.add(provider);
        else next.delete(provider);
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(
    async (provider: Provider, values: Record<string, string>) => {
      const update = buildUpdate(provider, values);
      const res = await save(update);
      if (!res.ok) return res;

      if (RESTART_PROVIDERS.has(provider)) {
        // race 対応: save 成功時点で restart=false なら skip
        if (opencodeRestartingRef.current === false) {
          // skip — restart 完了済み or restart 不要
        } else {
          setRestartingTimerActive((prev) => {
            const next = new Set(prev);
            next.add(provider);
            return next;
          });
          setTimeout(() => {
            setRestartingTimerActive((prev) => {
              if (!prev.has(provider)) return prev;
              const next = new Set(prev);
              next.delete(provider);
              return next;
            });
          }, RESTART_FALLBACK_MS);
        }
      }
      return res;
    },
    [save],
  );

  const handleDelete = useCallback(
    async (provider: Provider) => {
      return await remove(provider);
    },
    [remove],
  );

  if (!open) return null;

  const showRestartBanner = restartingTimerActive.size > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={tryAutoClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="bg-gray-800 text-gray-100 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="settings-dialog-title" className="text-lg font-bold">
            アクセスキーの設定
          </h2>
          <button
            type="button"
            onClick={closeWithDirtyCheck}
            className="text-gray-400 hover:text-white text-lg leading-none"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        {mandatory && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-blue-900/40 border border-blue-700/50 text-blue-100 text-xs">
            {MANDATORY_BANNER}
          </div>
        )}

        {showRestartBanner && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-700/30 border border-amber-700/50 text-amber-100 text-xs flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-amber-200/40 border-t-amber-100 rounded-full animate-spin" />
            AI を再起動しています…
          </div>
        )}

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-900/40 border border-red-700/50 text-red-200 text-xs">
            {error}
          </div>
        )}

        {loading && !status && (
          <p className="text-xs text-gray-400 mb-3">読み込み中…</p>
        )}

        <div className="space-y-3">
          {PROVIDERS.map((cfg) => {
            const cardStatus: ProviderCardStatus = status
              ? status[cfg.provider]
              : { set: false };
            return (
              <ProviderCard
                key={cfg.provider}
                provider={cfg.provider}
                title={cfg.title}
                helpText={cfg.helpText}
                helpUrl={cfg.helpUrl}
                helpUrlLabel={cfg.helpUrlLabel}
                fields={cfg.fields}
                status={cardStatus}
                saving={saving === cfg.provider}
                deleting={deleting === cfg.provider}
                onSave={(values) => handleSave(cfg.provider, values)}
                onDelete={() => handleDelete(cfg.provider)}
                onDirtyChange={(d) => handleProviderDirty(cfg.provider, d)}
              />
            );
          })}
        </div>

        {mandatory && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={closeWithDirtyCheck}
              className="text-xs text-gray-400 hover:text-gray-200 underline"
            >
              あとで設定する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

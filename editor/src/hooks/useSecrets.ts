import { useCallback, useEffect, useState } from "react";
import {
  SecretsApiError,
  deleteSecret,
  fetchSecretStatus,
  putSecrets,
} from "../lib/secrets-api";
import type { Provider, SecretStatus, SecretsUpdate } from "../types/secrets";

type ErrorKind = "load" | "save" | "delete";

const ERROR_MESSAGES: Record<ErrorKind, string> = {
  load: "読み込みに失敗しました",
  save: "保存に失敗しました",
  delete: "削除に失敗しました",
};

function translateError(kind: ErrorKind, _err: unknown): string {
  return ERROR_MESSAGES[kind];
}

export interface UseSecretsResult {
  status: SecretStatus | null;
  loading: boolean;
  saving: Provider | null;
  deleting: Provider | null;
  error: string | null;
  refresh: () => Promise<void>;
  save: (update: SecretsUpdate) => Promise<{ ok: boolean }>;
  remove: (provider: Provider) => Promise<{ ok: boolean }>;
}

function firstProviderOf(update: SecretsUpdate): Provider | null {
  if (update.openrouter) return "openrouter";
  if (update.gemini) return "gemini";
  if (update.cloudflare) return "cloudflare";
  if (update.firebase) return "firebase";
  return null;
}

export function useSecrets(): UseSecretsResult {
  const [status, setStatus] = useState<SecretStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSecretStatus();
      setStatus(next);
    } catch (err) {
      if (err instanceof SecretsApiError || err instanceof Error) {
        setError(translateError("load", err));
      } else {
        setError(translateError("load", err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (update: SecretsUpdate): Promise<{ ok: boolean }> => {
      const provider = firstProviderOf(update);
      if (!provider) return { ok: false };
      // Block concurrent saves/deletes
      if (saving || deleting) return { ok: false };

      setSaving(provider);
      setError(null);
      try {
        const next = await putSecrets(update);
        setStatus(next);
        return { ok: true };
      } catch (err) {
        setError(translateError("save", err));
        return { ok: false };
      } finally {
        setSaving(null);
      }
    },
    [saving, deleting],
  );

  const remove = useCallback(
    async (provider: Provider): Promise<{ ok: boolean }> => {
      if (saving || deleting) return { ok: false };
      setDeleting(provider);
      setError(null);
      try {
        const next = await deleteSecret(provider);
        setStatus(next);
        return { ok: true };
      } catch (err) {
        setError(translateError("delete", err));
        return { ok: false };
      } finally {
        setDeleting(null);
      }
    },
    [saving, deleting],
  );

  return {
    status,
    loading,
    saving,
    deleting,
    error,
    refresh,
    save,
    remove,
  };
}

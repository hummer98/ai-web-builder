import type { Provider, SecretStatus, SecretsUpdate } from "../types/secrets";

export type Fetcher = typeof fetch;

export class SecretsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SecretsApiError";
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === "string") {
      return data.error;
    }
  } catch {
    // ignore
  }
  return res.statusText || `HTTP ${res.status}`;
}

async function ensureOkOrThrow(res: Response): Promise<void> {
  if (res.ok) return;
  const code = await parseErrorBody(res);
  throw new SecretsApiError(res.status, `${code} (HTTP ${res.status})`);
}

export async function fetchSecretStatus(
  fetcher: Fetcher = fetch,
): Promise<SecretStatus> {
  const res = await fetcher("/api/secrets", {
    method: "GET",
    credentials: "same-origin",
    headers: JSON_HEADERS,
  });
  await ensureOkOrThrow(res);
  return (await res.json()) as SecretStatus;
}

export async function putSecrets(
  update: SecretsUpdate,
  fetcher: Fetcher = fetch,
): Promise<SecretStatus> {
  const res = await fetcher("/api/secrets", {
    method: "PUT",
    credentials: "same-origin",
    headers: JSON_HEADERS,
    body: JSON.stringify(update),
  });
  await ensureOkOrThrow(res);
  return (await res.json()) as SecretStatus;
}

export async function deleteSecret(
  provider: Provider,
  fetcher: Fetcher = fetch,
): Promise<SecretStatus> {
  const res = await fetcher(`/api/secrets/${provider}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: JSON_HEADERS,
  });
  await ensureOkOrThrow(res);
  return (await res.json()) as SecretStatus;
}

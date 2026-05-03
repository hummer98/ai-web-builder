export type VerifyResult = { ok: boolean; reasons: string[] };

const VITE_PORT = process.env.VITE_PORT ?? "5173";
const HONO_PORT = process.env.HONO_PORT ?? "3000";
const VERIFY_HOST = process.env.VERIFY_HOST ?? "127.0.0.1";

async function fetchWithTimeout(
  url: string,
  ms: number
): Promise<{ status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "manual",
    });
    return { status: res.status };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Vite と Hono が応答しているか確認する。
 * commit 直前に呼んで、応答しなければ commit を保留する用途。
 *
 * 200 系 / 304 / 301-302 は OK（Vite はトップで 302 を返すことがある）。
 * 4xx も「サーバーは生きている」と見なして OK。
 * 5xx と接続失敗だけを NG とする。
 */
export async function verifyServers(opts?: {
  timeoutMs?: number;
  viteUrl?: string;
  honoUrl?: string;
}): Promise<VerifyResult> {
  const timeout = opts?.timeoutMs ?? 3000;
  const viteUrl = opts?.viteUrl ?? `http://${VERIFY_HOST}:${VITE_PORT}/`;
  const honoUrl = opts?.honoUrl ?? `http://${VERIFY_HOST}:${HONO_PORT}/api/health`;
  const reasons: string[] = [];

  const checks: Array<[string, string]> = [
    ["Vite", viteUrl],
    ["Hono", honoUrl],
  ];

  for (const [name, url] of checks) {
    try {
      const { status } = await fetchWithTimeout(url, timeout);
      if (status >= 500) {
        reasons.push(`${name} returned HTTP ${status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reasons.push(`${name} unreachable (${msg})`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

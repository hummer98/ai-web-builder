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
 * Vite は必須、Hono は任意 (backend を持たない SPA 構成のゲストを許容する)。
 * - Vite: 5xx と接続失敗を NG とする (フロントが壊れた状態を commit しない)。
 * - Hono: 5xx は NG (起動しているが壊れている) だが、接続失敗は OK (Hono 不在を許容)。
 * 200 系 / 304 / 301-302 / 4xx は「サーバーは生きている」と見なして OK。
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

  const checks: Array<{ name: string; url: string; required: boolean }> = [
    { name: "Vite", url: viteUrl, required: true },
    { name: "Hono", url: honoUrl, required: false },
  ];

  for (const { name, url, required } of checks) {
    try {
      const { status } = await fetchWithTimeout(url, timeout);
      if (status >= 500) {
        reasons.push(`${name} returned HTTP ${status}`);
      }
    } catch (err) {
      // 接続失敗: 必須サーバー (Vite) のみ NG。任意サーバー (Hono) の不在は許容する。
      if (required) {
        const msg = err instanceof Error ? err.message : String(err);
        reasons.push(`${name} unreachable (${msg})`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

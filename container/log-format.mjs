// プレーンテキストのログ行を agent-server と同じ JSON Lines 形式に整形する共有ヘルパ。
//
// 目的: log-reader MCP の read_log(service, level) / search_log が「サービス別 ×
// レベル別」でログのセクションを取得できるようにする。vite / hono / opencode は
// プレーンテキストを吐くため、そのままだと read_log の level フィルタ
// (JSON.parse(line).level) が全行を捨ててしまう。ここで {ts, level, service, msg}
// に揃えることで、AI が必要なセクションだけをオンデマンドで引けるようにする。
//
// 依存なしの plain ESM。jsonl-wrap.mjs (シェルパイプ) と opencode-supervisor.ts
// (opencode child) の両方から import される単一の真実。

// ANSI カラーエスケープ (ESC[...m) を除去するパターン。
// ESC (0x1b) をリテラルで埋め込まず String.fromCharCode で組む。
const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

/**
 * ログ1行の level を内容から推定する。
 * 明示的なレベルトークンが見つからなければ defaultLevel を返す。
 * @param {string} msg ANSI 除去済みのメッセージ
 * @param {"info"|"warn"|"error"|"debug"} [defaultLevel]
 * @returns {"info"|"warn"|"error"|"debug"}
 */
export function inferLevel(msg, defaultLevel = "info") {
  const s = msg.toLowerCase();
  if (/\b(error|fatal|exception)\b|error:/.test(s)) return "error";
  if (/\b(warn|warning|deprecated)\b/.test(s)) return "warn";
  return defaultLevel;
}

/**
 * プレーンテキスト1行を JSON Lines ({ts, level, service, msg}) に整形する。
 * @param {string} service "vite" | "hono" | "opencode" 等
 * @param {string} rawLine 1行 (改行なし)
 * @param {"info"|"warn"|"error"|"debug"} [defaultLevel] レベル未検出時の既定値
 * @returns {string|null} 整形済み JSON 文字列 (改行なし)。空行は null (出力しない)。
 */
export function toJsonl(service, rawLine, defaultLevel = "info") {
  const msg = String(rawLine).replace(ANSI_PATTERN, "");
  if (msg.trim() === "") return null;
  return JSON.stringify({
    ts: new Date().toISOString(),
    level: inferLevel(msg, defaultLevel),
    service,
    msg,
  });
}

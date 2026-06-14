import type { Part } from "@opencode-ai/sdk";

/**
 * opencode (AI) の応答内容をサーバー側ログに永続化するための純粋ロジック。
 *
 * 背景: assistant のテキスト本文や tool 実行結果は opencode :4096 の SSE event
 * stream を ws 経由でブラウザに中継するだけで、どのサーバーログにも残っていなかった。
 * Machine 再起動 (Fly autostop で root FS ephemeral) で AI の問題分析が消え、
 * 事後の原因究明が不可能になっていた (本番の「白画面」障害で顕在化)。
 *
 * ここでは `message.part.updated` イベントが運ぶ {@link Part} を、
 * - assistant テキスト本文 (type:"text")
 * - tool 実行サマリ (type:"tool", state.status が completed / error)
 * の確定タイミングだけ JSON Lines 行に変換する。出力は logger 経由で
 * `/app/logs/opencode-messages.log` (本番) / `logs/opencode-messages.log` (ローカル)
 * に追記され、同内容が stdout (flyctl logs) にも出る。
 */

/** text 本文の最大保持文字数。根本原因の説明が切れない程度に広めに取る。 */
export const MAX_TEXT_CHARS = 4000;
/** tool の input/output サマリの最大文字数。 */
export const MAX_TOOL_FIELD_CHARS = 1000;

/** APIキー/トークンらしき文字列をマスクする (ログ漏洩防止)。 */
export function redactSecrets(input: string): string {
  return (
    input
      // data URL (base64 画像) は本文ごと落とす
      .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g, "[data URL omitted]")
      // sk-... / OpenRouter / Anthropic / generic bearer-ish tokens
      .replace(/\b(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
      .replace(/\b(sk-or-v1-[A-Za-z0-9_-]{8,})/g, "[redacted]")
      .replace(/\b(AIza[A-Za-z0-9_-]{20,})/g, "[redacted]")
      .replace(/\bghp_[A-Za-z0-9]{20,}/g, "[redacted]")
      .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
      // Authorization: Bearer xxx
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]{12,}/gi, "$1[redacted]")
  );
}

function clip(input: string, max: number): { text: string; truncated: boolean } {
  if (input.length <= max) return { text: input, truncated: false };
  return { text: input.slice(0, max), truncated: true };
}

export type AssistantTextLog = {
  kind: "assistant-text";
  sessionId: string;
  messageID: string;
  partId: string;
  text: string;
  truncated: boolean;
  chars: number;
};

export type ToolLog = {
  kind: "tool";
  sessionId: string;
  messageID: string;
  partId: string;
  tool: string;
  callID: string;
  status: "completed" | "error";
  /** bash 等の主要 input を文字列化したもの (command など)。 */
  input?: string;
  inputTruncated?: boolean;
  /** completed 時の output サマリ。 */
  output?: string;
  outputTruncated?: boolean;
  /** error 時のメッセージ。 */
  error?: string;
  durationMs?: number;
};

export type MessageLogEntry = AssistantTextLog | ToolLog;

/**
 * `message.part.updated` の Part を「永続化に値する確定イベント」に正規化する。
 * 確定でない (text 途中 / tool pending・running) 場合は null を返す。
 *
 * @param part      イベントの properties.part
 * @param sessionId 現在ハンドル中のセッション (突合用; part.sessionID と一致前提)
 */
export function partToLogEntry(part: Part, sessionId: string): MessageLogEntry | null {
  if (part.type === "text") {
    // 確定 = time.end が立った時点。途中の delta では time.end が無いのでスキップし、
    // 二重記録を避ける。synthetic / ignored なテキストは記録しない。
    if (part.synthetic || part.ignored) return null;
    if (!part.time?.end) return null;
    const raw = redactSecrets(part.text ?? "");
    if (!raw.trim()) return null;
    const { text, truncated } = clip(raw, MAX_TEXT_CHARS);
    return {
      kind: "assistant-text",
      sessionId,
      messageID: part.messageID,
      partId: part.id,
      text,
      truncated,
      chars: raw.length,
    };
  }

  if (part.type === "tool") {
    const state = part.state;
    if (state.status === "completed" || state.status === "error") {
      const inputStr = serializeToolInput(state.input);
      const base: ToolLog = {
        kind: "tool",
        sessionId,
        messageID: part.messageID,
        partId: part.id,
        tool: part.tool,
        callID: part.callID,
        status: state.status,
      };
      if (inputStr) {
        const { text, truncated } = clip(redactSecrets(inputStr), MAX_TOOL_FIELD_CHARS);
        base.input = text;
        base.inputTruncated = truncated;
      }
      if (state.time?.start && state.time?.end) {
        base.durationMs = state.time.end - state.time.start;
      }
      if (state.status === "completed") {
        const { text, truncated } = clip(
          redactSecrets(state.output ?? ""),
          MAX_TOOL_FIELD_CHARS
        );
        base.output = text;
        base.outputTruncated = truncated;
      } else {
        base.error = clip(redactSecrets(state.error ?? ""), MAX_TOOL_FIELD_CHARS).text;
      }
      return base;
    }
  }

  return null;
}

/**
 * tool input をログ向けの 1 行文字列にする。
 * bash の `command` や read/write の `filePath` 等、主要キーを優先して拾う。
 */
function serializeToolInput(input: { [key: string]: unknown }): string {
  if (!input || typeof input !== "object") return "";
  // よく使う代表キーを先に拾うと bash command がそのまま読める
  const command = input.command ?? input.cmd;
  if (typeof command === "string") return command;
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

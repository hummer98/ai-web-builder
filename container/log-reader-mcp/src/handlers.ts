import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import safeRegex from "safe-regex2";

const MAX_PATTERN_LENGTH = 200;

export function getLogDir(): string {
  return process.env.LOG_DIR ?? join(import.meta.dirname, "../../../logs");
}

export const SERVICES = [
  "agent-server",
  "opencode",
  "vite",
  "hono",
  "deploy",
] as const;

export async function readLog(params: {
  service: string;
  level: string;
  tail: number;
}) {
  const { service, level, tail } = params;
  const logDir = getLogDir();
  const logFile = join(logDir, `${service}.log`);

  if (!existsSync(logFile)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Log file not found: ${service}.log`,
        },
      ],
    };
  }

  const lines = readFileSync(logFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);

  const filtered =
    level === "all"
      ? lines
      : lines.filter((line) => {
          try {
            const entry = JSON.parse(line);
            return entry.level === level;
          } catch {
            return false;
          }
        });

  const result = filtered.slice(-tail).join("\n");

  return {
    content: [
      {
        type: "text" as const,
        text: result || `No ${level} logs found for ${service}`,
      },
    ],
  };
}

export async function searchLog(params: { pattern: string; tail: number }) {
  const { pattern, tail } = params;
  const logDir = getLogDir();

  if (!existsSync(logDir)) {
    return {
      content: [
        { type: "text" as const, text: "Log directory not found" },
      ],
    };
  }

  // ReDoS 対策: 長さ制限 + safe-regex2 で危険パターンを拒否
  if (pattern.length > MAX_PATTERN_LENGTH || !safeRegex(pattern)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Pattern rejected (length>${MAX_PATTERN_LENGTH} or unsafe regex)`,
        },
      ],
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid regex: ${String(err)}`,
        },
      ],
    };
  }
  const results: string[] = [];

  const files = readdirSync(logDir).filter((f) => f.endsWith(".log"));

  for (const file of files) {
    const lines = readFileSync(join(logDir, file), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);

    for (const line of lines) {
      if (regex.test(line)) {
        results.push(line);
      }
    }
  }

  const result = results.slice(-tail).join("\n");

  return {
    content: [
      {
        type: "text" as const,
        text: result || `No matches found for pattern: ${pattern}`,
      },
    ],
  };
}

// ── opencode session 軸 (HTTP API :4096) ────────────────────
//
// opencode の「実際の動作（どのツールを呼び、成功/失敗したか）」はログファイルに
// 残らず、HTTP API `/session/<id>/message` と SQLite にしかない。ファイルログの
// service×level 軸では取れないこのトレースを、session 軸で MCP から引けるようにする。

function getOpencodeUrl(): string {
  return process.env.OPENCODE_URL ?? "http://localhost:4096";
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…(+${s.length - n} chars)` : s;
}

/** ツール入力から人が読める1行サマリを作る (filePath / command / pattern を優先)。 */
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  if (typeof o.filePath === "string") return `file=${o.filePath}`;
  if (typeof o.command === "string") return `cmd=${truncate(o.command, 120)}`;
  if (typeof o.pattern === "string") return `pattern=${o.pattern}`;
  const keys = Object.keys(o);
  return keys.length ? `{${keys.join(",")}}` : "";
}

/** list_opencode_sessions: opencode の全セッション (id / title) を一覧する。 */
export async function listOpencodeSessions() {
  let sessions: unknown;
  try {
    const res = await fetch(`${getOpencodeUrl()}/session`);
    if (!res.ok) return textResult(`opencode API responded ${res.status}`);
    sessions = await res.json();
  } catch (e) {
    return textResult(`opencode API unreachable: ${String(e)}`);
  }
  if (!Array.isArray(sessions)) return textResult("Unexpected /session response shape");
  const lines = sessions.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return `${o.id ?? "?"}\t${o.title ?? ""}`;
  });
  return textResult(lines.join("\n") || "No sessions");
}

/**
 * read_opencode_session: 1セッションのツール呼び出しトレースを要約して返す。
 * 各ツールの status / 入力サマリ / 出力 / エラーを 1 行ずつ。出力は truncate する。
 */
export async function readOpencodeSession(params: {
  sessionId: string;
  tail: number;
}) {
  const { sessionId, tail } = params;
  let messages: unknown;
  try {
    const res = await fetch(
      `${getOpencodeUrl()}/session/${encodeURIComponent(sessionId)}/message`
    );
    if (!res.ok) {
      return textResult(`opencode API responded ${res.status} for session ${sessionId}`);
    }
    messages = await res.json();
  } catch (e) {
    return textResult(`opencode API unreachable: ${String(e)}`);
  }
  if (!Array.isArray(messages)) return textResult("Unexpected /message response shape");

  const toolLines: string[] = [];
  for (const msg of messages) {
    const parts = ((msg as Record<string, unknown>)?.parts ?? []) as unknown[];
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const part = (p ?? {}) as Record<string, unknown>;
      if (part.type !== "tool" && !part.tool) continue;
      const state = (part.state ?? {}) as Record<string, unknown>;
      const tool = String(part.tool ?? "tool");
      const status = String(state.status ?? "?");
      const inSum = summarizeInput(state.input);
      const out = state.output ? ` → ${truncate(String(state.output), 300)}` : "";
      const err = state.error ? ` ERROR: ${truncate(String(state.error), 300)}` : "";
      toolLines.push(`[${status}] ${tool} ${inSum}${out}${err}`.trim());
    }
  }

  const sliced = toolLines.slice(-tail);
  const header = `session ${sessionId}: ${toolLines.length} tool calls (showing last ${sliced.length})`;
  return textResult([header, ...sliced].join("\n"));
}

export async function listLogs() {
  const logDir = getLogDir();

  if (!existsSync(logDir)) {
    return {
      content: [
        { type: "text" as const, text: "Log directory not found" },
      ],
    };
  }

  const files = readdirSync(logDir).filter((f) => f.endsWith(".log"));
  const info = files.map((f) => {
    const lines = readFileSync(join(logDir, f), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    return `${f}: ${lines.length} lines`;
  });

  return {
    content: [
      {
        type: "text" as const,
        text: info.join("\n") || "No log files found",
      },
    ],
  };
}

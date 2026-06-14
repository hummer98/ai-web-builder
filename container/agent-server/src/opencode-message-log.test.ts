import { describe, it, expect } from "vitest";
import type { Part } from "@opencode-ai/sdk";
import {
  partToLogEntry,
  redactSecrets,
  MAX_TEXT_CHARS,
  MAX_TOOL_FIELD_CHARS,
} from "./opencode-message-log.js";

const SES = "ses_abc123";

function textPart(over: Partial<Extract<Part, { type: "text" }>>): Part {
  return {
    id: "prt_text1",
    sessionID: SES,
    messageID: "msg_1",
    type: "text",
    text: "原因は NODE_ENV=production で devDependencies が入らずビルドが壊れていたことです。",
    time: { start: 1, end: 2 },
    ...over,
  } as Part;
}

function toolPart(over: Record<string, unknown>): Part {
  return {
    id: "prt_tool1",
    sessionID: SES,
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "npm run build" },
      output: "exit code 0",
      title: "build",
      metadata: {},
      time: { start: 100, end: 350 },
    },
    ...over,
  } as Part;
}

describe("partToLogEntry — assistant text", () => {
  it("確定した text part を assistant-text として記録する", () => {
    const entry = partToLogEntry(textPart({}), SES);
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      kind: "assistant-text",
      sessionId: SES,
      messageID: "msg_1",
      partId: "prt_text1",
      truncated: false,
    });
    expect((entry as { text: string }).text).toContain("NODE_ENV=production");
  });

  it("time.end が無い (途中の) text part はスキップする", () => {
    const entry = partToLogEntry(textPart({ time: { start: 1 } }), SES);
    expect(entry).toBeNull();
  });

  it("synthetic / ignored な text はスキップする", () => {
    expect(partToLogEntry(textPart({ synthetic: true }), SES)).toBeNull();
    expect(partToLogEntry(textPart({ ignored: true }), SES)).toBeNull();
  });

  it("空文字の text はスキップする", () => {
    expect(partToLogEntry(textPart({ text: "   " }), SES)).toBeNull();
  });

  it("MAX_TEXT_CHARS を超える本文は truncate される", () => {
    const long = "あ".repeat(MAX_TEXT_CHARS + 500);
    const entry = partToLogEntry(textPart({ text: long }), SES) as {
      text: string;
      truncated: boolean;
      chars: number;
    };
    expect(entry.truncated).toBe(true);
    expect(entry.text.length).toBe(MAX_TEXT_CHARS);
    expect(entry.chars).toBe(MAX_TEXT_CHARS + 500);
  });

  it("API キーらしき文字列はマスクされる", () => {
    const entry = partToLogEntry(
      textPart({ text: "鍵は sk-or-v1-abcdef1234567890 です" }),
      SES
    ) as { text: string };
    expect(entry.text).not.toContain("abcdef1234567890");
    expect(entry.text).toContain("[redacted]");
  });
});

describe("partToLogEntry — tool", () => {
  it("completed の bash tool を command/output 付きで記録する", () => {
    const entry = partToLogEntry(toolPart({}), SES);
    expect(entry).toMatchObject({
      kind: "tool",
      tool: "bash",
      status: "completed",
      callID: "call_1",
      input: "npm run build",
      output: "exit code 0",
      durationMs: 250,
    });
  });

  it("error の tool を error メッセージ付きで記録する", () => {
    const entry = partToLogEntry(
      toolPart({
        state: {
          status: "error",
          input: { command: "npm install" },
          error: "npm ERR! missing @types/react",
          time: { start: 1, end: 5 },
        },
      }),
      SES
    );
    expect(entry).toMatchObject({
      kind: "tool",
      status: "error",
      input: "npm install",
      error: "npm ERR! missing @types/react",
    });
    expect((entry as { output?: string }).output).toBeUndefined();
  });

  it("pending / running の tool はスキップする", () => {
    expect(
      partToLogEntry(
        toolPart({ state: { status: "running", input: {}, time: { start: 1 } } }),
        SES
      )
    ).toBeNull();
    expect(
      partToLogEntry(
        toolPart({ state: { status: "pending", input: {}, raw: "" } }),
        SES
      )
    ).toBeNull();
  });

  it("command 以外の input は JSON 文字列化される", () => {
    const entry = partToLogEntry(
      toolPart({
        tool: "write",
        state: {
          status: "completed",
          input: { filePath: "src/App.tsx", content: "x" },
          output: "ok",
          title: "write",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
      SES
    ) as { input: string };
    expect(entry.input).toContain("src/App.tsx");
  });

  it("巨大な output は MAX_TOOL_FIELD_CHARS で truncate される", () => {
    const entry = partToLogEntry(
      toolPart({
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "x".repeat(MAX_TOOL_FIELD_CHARS + 100),
          title: "ls",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
      SES
    ) as { output: string; outputTruncated: boolean };
    expect(entry.outputTruncated).toBe(true);
    expect(entry.output.length).toBe(MAX_TOOL_FIELD_CHARS);
  });

  it("tool output 内のシークレットもマスクされる", () => {
    const entry = partToLogEntry(
      toolPart({
        state: {
          status: "completed",
          input: { command: "env" },
          output: "OPENROUTER_API_KEY=sk-or-v1-deadbeefcafef00d",
          title: "env",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
      SES
    ) as { output: string };
    expect(entry.output).not.toContain("deadbeefcafef00d");
    expect(entry.output).toContain("[redacted]");
  });
});

describe("redactSecrets", () => {
  it("data URL を落とす", () => {
    expect(redactSecrets("img data:image/png;base64,AAAABBBBCCCC end")).toContain(
      "[data URL omitted]"
    );
  });

  it("各種トークンをマスクする", () => {
    expect(redactSecrets("sk-abcdefgh12345678")).toContain("[redacted]");
    expect(redactSecrets("AIzaSyAbcdefghijklmnopqrstuvwxyz123")).toContain(
      "[redacted]"
    );
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz0123")).toContain(
      "[redacted]"
    );
    expect(redactSecrets("Authorization: Bearer abcdefghijkl1234")).toContain(
      "[redacted]"
    );
  });

  it("通常の文章はそのまま残す", () => {
    const s = "ヘッダーの色を青に変えました。";
    expect(redactSecrets(s)).toBe(s);
  });
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SERVICES,
  readLog,
  searchLog,
  listLogs,
  listOpencodeSessions,
  readOpencodeSession,
} from "./handlers.js";

const server = new McpServer({
  name: "log-reader",
  version: "0.0.1",
});

/**
 * read_log: 特定サービスのログを末尾から読み取る
 */
server.tool(
  "read_log",
  {
    service: z
      .enum(SERVICES)
      .describe("ログを読むサービス名"),
    level: z
      .enum(["info", "warn", "error", "debug", "all"])
      .default("all")
      .describe("フィルタするログレベル（allで全件）"),
    tail: z
      .number()
      .default(50)
      .describe("末尾から何行読むか"),
  },
  async ({ service, level, tail }) => readLog({ service, level, tail })
);

/**
 * search_log: 全ログからパターン検索
 */
server.tool(
  "search_log",
  {
    pattern: z.string().describe("検索するパターン（正規表現対応）"),
    tail: z
      .number()
      .default(30)
      .describe("最大何件返すか"),
  },
  async ({ pattern, tail }) => searchLog({ pattern, tail })
);

/**
 * list_logs: 利用可能なログファイル一覧
 */
server.tool("list_logs", {}, async () => listLogs());

/**
 * list_opencode_sessions: opencode の全セッション (id / title) を一覧する。
 * ファイルログには無い「opencode が実際に何をしたか」を session 軸で辿る入口。
 */
server.tool("list_opencode_sessions", {}, async () => listOpencodeSessions());

/**
 * read_opencode_session: 1セッションのツール呼び出しトレース (status/入力/出力/エラー)
 * を要約して返す。read/edit/bash 等が completed か error かをここで確認できる。
 */
server.tool(
  "read_opencode_session",
  {
    sessionId: z.string().describe("opencode のセッション ID"),
    tail: z
      .number()
      .default(50)
      .describe("末尾から何件のツール呼び出しを返すか"),
  },
  async ({ sessionId, tail }) => readOpencodeSession({ sessionId, tail })
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

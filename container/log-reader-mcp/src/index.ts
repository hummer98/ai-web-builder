import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SERVICES, readLog, searchLog, listLogs } from "./handlers.js";

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

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

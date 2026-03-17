import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(import.meta.dirname, "../../../logs");

const SERVICES = [
  "agent-server",
  "opencode",
  "vite",
  "hono",
  "deploy",
] as const;

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
  async ({ service, level, tail }) => {
    const logFile = join(LOG_DIR, `${service}.log`);

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
  async ({ pattern, tail }) => {
    if (!existsSync(LOG_DIR)) {
      return {
        content: [
          { type: "text" as const, text: "Log directory not found" },
        ],
      };
    }

    const regex = new RegExp(pattern, "i");
    const results: string[] = [];

    const files = readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"));

    for (const file of files) {
      const lines = readFileSync(join(LOG_DIR, file), "utf-8")
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
);

/**
 * list_logs: 利用可能なログファイル一覧
 */
server.tool("list_logs", {}, async () => {
  if (!existsSync(LOG_DIR)) {
    return {
      content: [
        { type: "text" as const, text: "Log directory not found" },
      ],
    };
  }

  const files = readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"));
  const info = files.map((f) => {
    const lines = readFileSync(join(LOG_DIR, f), "utf-8")
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
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

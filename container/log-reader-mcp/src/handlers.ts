import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

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

  const regex = new RegExp(pattern, "i");
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

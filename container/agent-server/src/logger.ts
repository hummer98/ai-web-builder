import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(import.meta.dirname, "../../../logs");

mkdirSync(LOG_DIR, { recursive: true });

type Level = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  level: Level;
  service: string;
  msg: string;
  [key: string]: unknown;
}

export function createLogger(service: string) {
  const logFile = join(LOG_DIR, `${service}.log`);

  function log(level: Level, msg: string, extra?: Record<string, unknown>) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      service,
      msg,
      ...extra,
    };
    const line = JSON.stringify(entry);
    appendFileSync(logFile, line + "\n");
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
    debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
  };
}

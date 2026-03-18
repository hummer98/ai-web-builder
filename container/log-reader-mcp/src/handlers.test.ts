import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLog, searchLog, listLogs } from "./handlers.js";

function text(result: { content: { text: string }[] }): string {
  return result.content[0].text;
}

describe("log-reader-mcp handlers", () => {
  let tmpDir: string;

  const logLines = [
    '{"ts":"2026-03-19T00:00:00Z","level":"info","service":"vite","msg":"HMR update"}',
    '{"ts":"2026-03-19T00:00:01Z","level":"error","service":"vite","msg":"Build failed"}',
    '{"ts":"2026-03-19T00:00:02Z","level":"info","service":"vite","msg":"Rebuild OK"}',
  ];

  const honoLines = [
    '{"ts":"2026-03-19T00:00:02Z","level":"info","service":"hono","msg":"Request received"}',
    '{"ts":"2026-03-19T00:00:03Z","level":"error","service":"hono","msg":"500 Internal Server Error"}',
  ];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "log-reader-test-"));
    vi.stubEnv("LOG_DIR", tmpDir);
    writeFileSync(join(tmpDir, "vite.log"), logLines.join("\n") + "\n");
    writeFileSync(join(tmpDir, "hono.log"), honoLines.join("\n") + "\n");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── readLog ──────────────────────────────────────────────

  describe("readLog", () => {
    it("reads logs for specified service", async () => {
      const result = await readLog({ service: "vite", level: "all", tail: 50 });
      const t = text(result);
      expect(t).toContain("HMR update");
      expect(t).toContain("Build failed");
      expect(t).toContain("Rebuild OK");
    });

    it("filters by level=info", async () => {
      const result = await readLog({ service: "vite", level: "info", tail: 50 });
      const t = text(result);
      expect(t).toContain("HMR update");
      expect(t).toContain("Rebuild OK");
      expect(t).not.toContain("Build failed");
    });

    it("filters by level=error", async () => {
      const result = await readLog({ service: "vite", level: "error", tail: 50 });
      const t = text(result);
      expect(t).toContain("Build failed");
      expect(t).not.toContain("HMR update");
    });

    it("limits output with tail", async () => {
      const result = await readLog({ service: "vite", level: "all", tail: 1 });
      const t = text(result);
      // tail=1 should return only the last line
      expect(t).toContain("Rebuild OK");
      expect(t).not.toContain("HMR update");
    });

    it("returns 'Log file not found' for non-existent service", async () => {
      const result = await readLog({ service: "nonexistent", level: "all", tail: 50 });
      expect(text(result)).toBe("Log file not found: nonexistent.log");
    });
  });

  // ── searchLog ────────────────────────────────────────────

  describe("searchLog", () => {
    it("searches across all logs with regex pattern", async () => {
      const result = await searchLog({ pattern: "error", tail: 30 });
      const t = text(result);
      expect(t).toContain("Build failed");
      expect(t).toContain("500 Internal Server Error");
    });

    it("limits results with tail", async () => {
      const result = await searchLog({ pattern: "info", tail: 1 });
      const lines = text(result).split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
    });

    it("returns 'No matches found' when nothing matches", async () => {
      const result = await searchLog({ pattern: "zzz_no_match_zzz", tail: 30 });
      expect(text(result)).toBe("No matches found for pattern: zzz_no_match_zzz");
    });

    it("returns 'Log directory not found' when LOG_DIR does not exist", async () => {
      vi.stubEnv("LOG_DIR", "/tmp/nonexistent-dir-abc123");
      const result = await searchLog({ pattern: "test", tail: 30 });
      expect(text(result)).toBe("Log directory not found");
    });
  });

  // ── listLogs ─────────────────────────────────────────────

  describe("listLogs", () => {
    it("lists all .log files with line counts", async () => {
      const result = await listLogs();
      const t = text(result);
      expect(t).toContain("vite.log: 3 lines");
      expect(t).toContain("hono.log: 2 lines");
    });

    it("returns 'No log files found' when directory is empty", async () => {
      // Remove log files but keep dir
      rmSync(join(tmpDir, "vite.log"));
      rmSync(join(tmpDir, "hono.log"));
      const result = await listLogs();
      expect(text(result)).toBe("No log files found");
    });
  });
});

import { describe, it, expect } from "vitest";
import { toJsonl, inferLevel } from "./log-format.mjs";

const ESC = String.fromCharCode(27);

describe("inferLevel", () => {
  it("error トークンを error に分類する", () => {
    expect(inferLevel("Internal server error")).toBe("error");
    expect(inferLevel("Error: build failed")).toBe("error");
    expect(inferLevel("Uncaught exception")).toBe("error");
    expect(inferLevel("FATAL: out of memory")).toBe("error");
  });

  it("warn トークンを warn に分類する", () => {
    expect(inferLevel("Warning: deprecated API")).toBe("warn");
    expect(inferLevel("this is deprecated")).toBe("warn");
  });

  it("トークンが無ければ defaultLevel を返す", () => {
    expect(inferLevel("HMR update /src/App.tsx")).toBe("info");
    expect(inferLevel("server started", "warn")).toBe("warn");
  });

  it("error が warn より優先される", () => {
    expect(inferLevel("warning AND error here")).toBe("error");
  });
});

describe("toJsonl", () => {
  it("JSON Lines 1 行 ({ts,level,service,msg}) を返す", () => {
    const line = toJsonl("vite", "HMR update");
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({ level: "info", service: "vite", msg: "HMR update" });
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts).toString()).not.toBe("Invalid Date");
  });

  it("read_log の level フィルタ前提 (JSON.parse(line).level) を満たす", () => {
    const entry = JSON.parse(toJsonl("hono", "500 Internal Server error"));
    expect(entry.level).toBe("error");
    expect(entry.service).toBe("hono");
  });

  it("defaultLevel を反映する (opencode stderr=warn)", () => {
    expect(JSON.parse(toJsonl("opencode", "starting up", "warn")).level).toBe("warn");
  });

  it("ANSI カラーエスケープを除去する", () => {
    const colored = `${ESC}[31mError${ESC}[0m: boom`;
    const entry = JSON.parse(toJsonl("vite", colored));
    expect(entry.msg).toBe("Error: boom");
    expect(entry.level).toBe("error");
  });

  it("空行・空白のみの行は null を返す (出力しない)", () => {
    expect(toJsonl("vite", "")).toBeNull();
    expect(toJsonl("vite", "   ")).toBeNull();
    expect(toJsonl("vite", `${ESC}[0m`)).toBeNull();
  });

  it("改行を含まない 1 行を出力する", () => {
    const line = toJsonl("vite", "ready in 300ms");
    expect(line).not.toContain("\n");
  });
});

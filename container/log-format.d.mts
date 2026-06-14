// log-format.mjs の型宣言 (TS7016 回避 / DX 用)。実行・ビルドには不要。
export type Level = "info" | "warn" | "error" | "debug";

export function inferLevel(msg: string, defaultLevel?: Level): Level;

export function toJsonl(
  service: string,
  rawLine: string,
  defaultLevel?: Level
): string | null;

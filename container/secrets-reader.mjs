import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SECRETS_FILE env → /data/secrets.json → <repo>/data/secrets.json の優先順で解決。
 * secrets-store.ts と同じロジックをここに集約する。
 */
export function resolveSecretsPath() {
  const fromEnv = process.env.SECRETS_FILE;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (existsSync("/data")) return "/data/secrets.json";
  return resolve(dirname(fileURLToPath(import.meta.url)), "../data/secrets.json");
}

/**
 * secrets.json を読み、OpenCode 起動に必要な openrouter / gemini の apiKey を返す。
 * - ファイル不在 / 不正 JSON / 空文字 → {} を返す（throw しない）
 * - cloudflare / firebase など他プロバイダは無視
 */
export function loadOpencodeRelevantSecrets() {
  const path = resolveSecretsPath();
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    return {};
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") return {};
  const out = {};
  if (
    data.openrouter &&
    typeof data.openrouter === "object" &&
    typeof data.openrouter.apiKey === "string" &&
    data.openrouter.apiKey.length > 0
  ) {
    out.openrouterApiKey = data.openrouter.apiKey;
  }
  if (
    data.gemini &&
    typeof data.gemini === "object" &&
    typeof data.gemini.apiKey === "string" &&
    data.gemini.apiKey.length > 0
  ) {
    out.geminiApiKey = data.gemini.apiKey;
  }
  return out;
}

import { readFileSync, writeFileSync } from "node:fs";
import { loadOpencodeRelevantSecrets } from "./secrets-reader.mjs";

/**
 * ワークスペースにコピーされた opencode.json を後処理する。
 *
 * - `instructions` に共通 md / SITE_BRIEF.md の絶対パスを injection する（idempotent）
 * - scaffold 由来の相対パスエントリを除去する
 * - `provider.openrouter.options.apiKey` を実値に置換、未指定なら delete
 * - `mcp['nano-banana'].environment.GEMINI_API_KEY` を実値に置換、未指定なら delete
 *
 * start.sh（本番コンテナ）と site-init.ts（ローカル開発）の両方から呼ばれる。
 */
export function postprocessOpencodeJson(jsonPath, options) {
  if (!options || typeof options.commonMdAbsPath !== "string" || !options.commonMdAbsPath) {
    throw new Error("commonMdAbsPath is required");
  }
  const {
    commonMdAbsPath,
    siteBriefAbsPath,
    openrouterApiKey,
    geminiApiKey,
    nanoBananaApiKey,
  } = options;

  // gemini / nano-banana は alias。geminiApiKey を優先。
  const effectiveGeminiKey =
    typeof geminiApiKey === "string" && geminiApiKey.length > 0
      ? geminiApiKey
      : typeof nanoBananaApiKey === "string" && nanoBananaApiKey.length > 0
      ? nanoBananaApiKey
      : undefined;

  const raw = readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(raw);
  if (data === null || typeof data !== "object") {
    throw new Error(`opencode.json must be a JSON object: ${jsonPath}`);
  }

  if (!Array.isArray(data.instructions)) {
    data.instructions = [];
  }

  data.instructions = data.instructions.filter((p) => {
    if (typeof p !== "string") return false;
    if (p === commonMdAbsPath) return true;
    if (typeof siteBriefAbsPath === "string" && p === siteBriefAbsPath) return true;
    if (p.endsWith("/container/instructions/common.md")) return false;
    if (p.endsWith("/SITE_BRIEF.md") || p === "./SITE_BRIEF.md") return false;
    return true;
  });

  if (!data.instructions.includes(commonMdAbsPath)) {
    data.instructions.push(commonMdAbsPath);
  }
  if (
    typeof siteBriefAbsPath === "string" &&
    siteBriefAbsPath.length > 0 &&
    !data.instructions.includes(siteBriefAbsPath)
  ) {
    data.instructions.push(siteBriefAbsPath);
  }

  // openrouter apiKey の処理
  if (
    data.provider &&
    typeof data.provider === "object" &&
    data.provider.openrouter &&
    typeof data.provider.openrouter === "object"
  ) {
    const opt = data.provider.openrouter.options;
    if (opt && typeof opt === "object") {
      if (typeof openrouterApiKey === "string" && openrouterApiKey.length > 0) {
        opt.apiKey = openrouterApiKey;
      } else {
        delete opt.apiKey;
      }
    }
  }

  // nano-banana environment.GEMINI_API_KEY の処理
  if (
    data.mcp &&
    typeof data.mcp === "object" &&
    data.mcp["nano-banana"] &&
    typeof data.mcp["nano-banana"] === "object"
  ) {
    const existing = data.mcp["nano-banana"].environment;
    if (effectiveGeminiKey !== undefined) {
      const env = existing && typeof existing === "object" ? { ...existing } : {};
      env.GEMINI_API_KEY = effectiveGeminiKey;
      data.mcp["nano-banana"].environment = env;
    } else if (existing && typeof existing === "object") {
      const env = { ...existing };
      delete env.GEMINI_API_KEY;
      data.mcp["nano-banana"].environment = env;
    }
  }

  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n");
}

function parseArgs(argv) {
  const [, , jsonPath, ...rest] = argv;
  if (!jsonPath) {
    throw new Error(
      "usage: node opencode-postprocess.mjs <opencode.json> --common=<abs-path> [--site-brief=<abs-path>] [--from-secrets]"
    );
  }
  const opts = {};
  let fromSecrets = false;
  for (const arg of rest) {
    if (arg.startsWith("--common=")) {
      opts.commonMdAbsPath = arg.slice("--common=".length);
    } else if (arg.startsWith("--site-brief=")) {
      opts.siteBriefAbsPath = arg.slice("--site-brief=".length);
    } else if (arg === "--from-secrets" || arg.startsWith("--from-secrets=")) {
      fromSecrets = true;
    }
  }
  return { jsonPath, opts, fromSecrets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { jsonPath, opts, fromSecrets } = parseArgs(process.argv);
  if (fromSecrets) {
    const fromStore = loadOpencodeRelevantSecrets();
    if (fromStore.openrouterApiKey) opts.openrouterApiKey = fromStore.openrouterApiKey;
    if (fromStore.geminiApiKey) opts.geminiApiKey = fromStore.geminiApiKey;
  }
  postprocessOpencodeJson(jsonPath, opts);
}

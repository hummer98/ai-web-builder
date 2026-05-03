import { readFileSync, writeFileSync } from "node:fs";

/**
 * ワークスペースにコピーされた opencode.json を後処理する。
 *
 * - `instructions` に共通 md の絶対パスを injection する（idempotent）
 * - `instructions` に SITE_BRIEF.md の絶対パスを injection する（idempotent、任意）
 * - scaffold 由来の相対パスエントリ（common.md / SITE_BRIEF.md を指すもの）は除去する
 * - `mcp['nano-banana'].environment.GEMINI_API_KEY` を実値に置換する
 *
 * start.sh（本番コンテナ）と site-init.ts（ローカル開発）の両方から呼ばれる。
 */
export function postprocessOpencodeJson(jsonPath, options) {
  if (!options || typeof options.commonMdAbsPath !== "string" || !options.commonMdAbsPath) {
    throw new Error("commonMdAbsPath is required");
  }
  const { commonMdAbsPath, nanoBananaApiKey, siteBriefAbsPath } = options;

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

  if (
    typeof nanoBananaApiKey === "string" &&
    nanoBananaApiKey.length > 0 &&
    data.mcp &&
    typeof data.mcp === "object" &&
    data.mcp["nano-banana"] &&
    typeof data.mcp["nano-banana"] === "object"
  ) {
    const existing = data.mcp["nano-banana"].environment;
    const env = existing && typeof existing === "object" ? { ...existing } : {};
    env.GEMINI_API_KEY = nanoBananaApiKey;
    data.mcp["nano-banana"].environment = env;
  }

  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n");
}

function parseArgs(argv) {
  const [, , jsonPath, ...rest] = argv;
  if (!jsonPath) {
    throw new Error(
      "usage: node opencode-postprocess.mjs <opencode.json> --common=<abs-path> [--nano-banana-key=<key>]"
    );
  }
  const opts = {};
  for (const arg of rest) {
    if (arg.startsWith("--common=")) {
      opts.commonMdAbsPath = arg.slice("--common=".length);
    } else if (arg.startsWith("--nano-banana-key=")) {
      opts.nanoBananaApiKey = arg.slice("--nano-banana-key=".length);
    } else if (arg.startsWith("--site-brief=")) {
      opts.siteBriefAbsPath = arg.slice("--site-brief=".length);
    }
  }
  return { jsonPath, opts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { jsonPath, opts } = parseArgs(process.argv);
  postprocessOpencodeJson(jsonPath, opts);
}

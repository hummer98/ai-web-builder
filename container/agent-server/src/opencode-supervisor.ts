import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createLogger } from "./logger.js";
// プレーンテキストの opencode 出力を JSON Lines に整形する共有ヘルパ (vite/hono と共用)。
import { toJsonl } from "../../log-format.mjs";
import { broadcastSystem } from "./ws-clients.js";

const execFileAsync = promisify(execFile);
const log = createLogger("agent-server");

export type StartOptions = {
  cwd: string;
  port?: number;
  hostname?: string;
  logsDir?: string;
  postprocessScript: string;
  commonMdPath: string;
  siteBriefPath?: string;
  /** waitForReady のタイムアウト (テスト用に短縮可能)。default 10_000 */
  readyTimeoutMs?: number;
  /** SIGTERM 後の SIGKILL までの猶予 (テスト用に短縮可能)。default 3_000 */
  killTimeoutMs?: number;
};

let child: ChildProcess | undefined;
let restarting = false;
let opts: StartOptions | undefined;

export function isRestarting(): boolean {
  return restarting;
}

export async function startOpencode(options: StartOptions): Promise<void> {
  opts = options;
  await runPostprocess();
  child = spawnChild();
  await waitForReady();
}

export async function stopOpencode(): Promise<void> {
  if (!child) return;
  const c = child;
  child = undefined;
  if (c.exitCode !== null && c.exitCode !== undefined) return;
  try {
    c.kill("SIGTERM");
  } catch {
    // 既に exit 済み等
    return;
  }
  const killTimeoutMs = opts?.killTimeoutMs ?? 3000;
  await new Promise<void>((res) => {
    const t = setTimeout(() => {
      try {
        c.kill("SIGKILL");
      } catch {
        // 無視
      }
      res();
    }, killTimeoutMs);
    c.once("exit", () => {
      clearTimeout(t);
      res();
    });
  });
}

export async function restartOpencode(): Promise<void> {
  if (!opts) throw new Error("supervisor not initialized");
  restarting = true;
  broadcastSystem("opencode_restarting");
  try {
    await stopOpencode();
    await runPostprocess();
    child = spawnChild();
    await waitForReady();
    broadcastSystem("opencode_ready");
  } finally {
    restarting = false;
  }
}

/**
 * opencode-postprocess.mjs を非同期で実行。restart 中に event loop を止めない。
 */
async function runPostprocess(): Promise<void> {
  if (!opts) throw new Error("supervisor not initialized");
  const args = [
    opts.postprocessScript,
    `${opts.cwd}/opencode.json`,
    `--common=${opts.commonMdPath}`,
  ];
  if (opts.siteBriefPath) args.push(`--site-brief=${opts.siteBriefPath}`);
  args.push("--from-secrets");
  await execFileAsync("node", args, { timeout: 10_000 });
}

/**
 * spawn の env から既存プロバイダキーを必ず削除する（キー漏洩防止の中核）。
 *
 * BYOK 必須化のため、ホスト側 env (Fly Secrets / direnv) からの継承を遮断する。
 * postprocess が opencode.json に実値を書き込んでいる前提で、env 経由の fallback を全て塞ぐ。
 *
 * さらに NODE_ENV を development に固定する。agent-server は本番認証のため
 * NODE_ENV=production で起動するが、その値が opencode child → ゲストの
 * `npm install` に継承されると devDependencies (@types/react / vite / typescript)
 * が入らずビルドが壊れる (本番「白画面」障害の真因)。ゲストのビルド環境は常に
 * development であるべきなので、ここで上書きする (vite/hono も development で起動)。
 */
export function buildSanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  env.NODE_ENV = "development";
  return env;
}

function spawnChild(): ChildProcess {
  if (!opts) throw new Error("supervisor not initialized");
  const port = opts.port ?? 4096;
  const hostname = opts.hostname ?? "127.0.0.1";
  const logsDir = opts.logsDir ?? "/app/logs";
  const c = spawn(
    "opencode",
    ["serve", "--port", String(port), "--hostname", hostname],
    {
      cwd: opts.cwd,
      env: buildSanitizedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  // opencode のプレーンテキスト出力を JSON Lines ({ts,level,service:"opencode",msg})
  // に整形して opencode.log と Fly stdout の両方へ流す。
  // ・1 サービス = 1 ファイルを保つ (agent-server.log を汚染しない)
  // ・全行 JSON Lines に揃え、log-reader MCP の read_log(level) フィルタを効かせる
  // 失敗しても supervisor 自体を落とさない。
  try {
    const logStream = createWriteStream(`${logsDir}/opencode.log`, { flags: "a" });
    logStream.on("error", (e) => {
      log.warn("opencode log write failed", { error: String(e) });
    });
    pipeAsJsonl(c.stdout, "info", logStream);
    pipeAsJsonl(c.stderr, "warn", logStream);
  } catch (e) {
    log.warn("opencode log stream init failed", { error: String(e) });
  }
  c.on("exit", (code, signal) => {
    log.info("opencode child exited", { code, signal });
  });
  return c;
}

/**
 * opencode child の stdout/stderr を 1 行ずつ JSON Lines に整形し、
 * opencode.log (ファイル) と process.stdout (Fly stdout) の両方へ書く。
 * agent-server 自身の stdout を経由するが、agent-server.log は logger の
 * appendFileSync が別途書くため、ここで混入することはない。
 */
function pipeAsJsonl(
  src: NodeJS.ReadableStream | null | undefined,
  defaultLevel: "info" | "warn",
  logStream: WriteStream
): void {
  if (!src) return;
  const rl = createInterface({ input: src, crlfDelay: Infinity });
  rl.on("line", (raw) => {
    const line = toJsonl("opencode", raw, defaultLevel);
    if (line === null) return;
    try {
      logStream.write(line + "\n");
    } catch {
      // 書き込み失敗は無視 (supervisor を落とさない)
    }
    process.stdout.write(line + "\n");
  });
}

async function waitForReady(): Promise<void> {
  if (!opts) throw new Error("supervisor not initialized");
  const port = opts.port ?? 4096;
  const timeoutMs = opts.readyTimeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((res) => {
      const s = connect(port, "127.0.0.1");
      const cleanup = (v: boolean) => {
        try {
          s.destroy();
        } catch {
          // 無視
        }
        res(v);
      };
      s.once("connect", () => cleanup(true));
      s.once("error", () => cleanup(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`opencode not ready on :${port} within ${timeoutMs}ms`);
}

/**
 * テスト用: モジュール内部状態をリセットする。
 * 本番コードからは呼ばないこと。
 */
export function __resetForTest(): void {
  child = undefined;
  restarting = false;
  opts = undefined;
}

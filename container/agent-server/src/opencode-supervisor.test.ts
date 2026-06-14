import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockedFunction,
} from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// child_process のモック
const spawnMock = vi.fn();
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

// node:net.connect のモック
const connectMock = vi.fn();
vi.mock("node:net", () => ({
  connect: (...args: unknown[]) => connectMock(...args),
}));

// fs createWriteStream のモック (stdout/stderr pipe を無害化)
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    createWriteStream: () => {
      const s = new PassThrough();
      return s;
    },
  };
});

// ws-clients.broadcastSystem のスパイ
const broadcastSystemMock = vi.fn();
vi.mock("./ws-clients.js", () => ({
  broadcastSystem: (...args: unknown[]) => broadcastSystemMock(...args),
  addClient: vi.fn(),
  removeClient: vi.fn(),
}));

import {
  startOpencode,
  stopOpencode,
  restartOpencode,
  isRestarting,
  buildSanitizedEnv,
  __resetForTest,
} from "./opencode-supervisor.js";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
};

function createFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild;
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.kill = vi.fn();
  ee.exitCode = null;
  return ee;
}

type FakeSocket = EventEmitter & {
  destroy: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function createFakeSocket(): FakeSocket {
  const ee = new EventEmitter() as FakeSocket;
  ee.destroy = vi.fn();
  ee.end = vi.fn();
  return ee;
}

const baseOptions = {
  cwd: "/data/workspace",
  port: 14096,
  hostname: "127.0.0.1",
  logsDir: "/tmp/__supervisor_logs__",
  postprocessScript: "/app/container/opencode-postprocess.mjs",
  commonMdPath: "/app/container/instructions/common.md",
  siteBriefPath: "/data/workspace/SITE_BRIEF.md",
  readyTimeoutMs: 500,
};

const DECOYS = {
  openrouter: "OPENROUTER_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG",
  gemini: "GEMINI_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG",
  anthropic: "ANTHROPIC_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG",
  openai: "OPENAI_TEST_LEAK_CANARY_VALUE_DO_NOT_LOG",
};

function setupSuccessfulConnect() {
  connectMock.mockImplementation(() => {
    const s = createFakeSocket();
    setImmediate(() => s.emit("connect"));
    return s;
  });
}

function setupFailingConnect() {
  connectMock.mockImplementation(() => {
    const s = createFakeSocket();
    setImmediate(() => s.emit("error", new Error("ECONNREFUSED")));
    return s;
  });
}

function setupExecFileSuccess() {
  // promisify(execFile) は (file, args, options, callback) で呼ばれる
  execFileMock.mockImplementation((..._args: unknown[]) => {
    const cb = _args[_args.length - 1] as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    setImmediate(() => cb(null, "", ""));
  });
}

function setupExecFileFailure(err: Error) {
  execFileMock.mockImplementation((..._args: unknown[]) => {
    const cb = _args[_args.length - 1] as (
      e: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    setImmediate(() => cb(err, "", ""));
  });
}

beforeEach(() => {
  __resetForTest();
  spawnMock.mockReset();
  execFileMock.mockReset();
  connectMock.mockReset();
  broadcastSystemMock.mockReset();
  vi.stubEnv("OPENROUTER_API_KEY", DECOYS.openrouter);
  vi.stubEnv("GEMINI_API_KEY", DECOYS.gemini);
  vi.stubEnv("ANTHROPIC_API_KEY", DECOYS.anthropic);
  vi.stubEnv("OPENAI_API_KEY", DECOYS.openai);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("buildSanitizedEnv", () => {
  it("OPENROUTER_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY が削除される", () => {
    const env = buildSanitizedEnv();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("PATH 等の他の env は保持される", () => {
    const env = buildSanitizedEnv();
    // process.env.PATH は通常存在する
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("NODE_ENV を development に固定する (ゲスト npm install に production を漏らさない)", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const env = buildSanitizedEnv();
      // agent-server が production で起動していても、opencode child へは development を渡す。
      // devDependencies が入らずビルドが壊れる「白画面」障害の再発防止。
      expect(env.NODE_ENV).toBe("development");
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("シリアライズしても decoy 値が一切現れない", () => {
    const env = buildSanitizedEnv();
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain(DECOYS.openrouter);
    expect(serialized).not.toContain(DECOYS.gemini);
    expect(serialized).not.toContain(DECOYS.anthropic);
    expect(serialized).not.toContain(DECOYS.openai);
  });
});

describe("startOpencode", () => {
  it("指定 cwd / port / hostname で spawn される", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    spawnMock.mockReturnValue(createFakeChild());

    await startOpencode(baseOptions);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = spawnMock.mock.calls[0];
    expect(cmd).toBe("opencode");
    expect(args).toEqual(["serve", "--port", "14096", "--hostname", "127.0.0.1"]);
    expect((options as { cwd: string }).cwd).toBe("/data/workspace");
  });

  it("spawn の引数 (argv) に decoy 値が含まれない", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    spawnMock.mockReturnValue(createFakeChild());

    await startOpencode(baseOptions);

    const [cmd, args] = spawnMock.mock.calls[0];
    const argvSerialized = JSON.stringify([cmd, ...(args as string[])]);
    expect(argvSerialized).not.toContain(DECOYS.openrouter);
    expect(argvSerialized).not.toContain(DECOYS.gemini);
    expect(argvSerialized).not.toContain(DECOYS.anthropic);
    expect(argvSerialized).not.toContain(DECOYS.openai);
  });

  it("spawn の env からプロバイダキーが削除されている", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    spawnMock.mockReturnValue(createFakeChild());

    await startOpencode(baseOptions);

    const [, , options] = spawnMock.mock.calls[0];
    const env = (options as { env: NodeJS.ProcessEnv }).env;
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    // PATH は残る
    expect(env.PATH).toBe(process.env.PATH);
    // env のシリアライズ結果に decoy が漏れていない
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain(DECOYS.openrouter);
    expect(serialized).not.toContain(DECOYS.gemini);
    expect(serialized).not.toContain(DECOYS.anthropic);
    expect(serialized).not.toContain(DECOYS.openai);
  });

  it("execFile (postprocess) が --from-secrets で呼ばれる", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    spawnMock.mockReturnValue(createFakeChild());

    await startOpencode(baseOptions);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe("node");
    expect(args).toContain("--from-secrets");
    expect(args).toContain("--common=/app/container/instructions/common.md");
    expect(args).toContain("--site-brief=/data/workspace/SITE_BRIEF.md");
    // postprocess に decoy 値を引数で渡していない
    const argvSerialized = JSON.stringify(args);
    expect(argvSerialized).not.toContain(DECOYS.openrouter);
    expect(argvSerialized).not.toContain(DECOYS.gemini);
  });

  it("startOpencode 完了直後は ready 状態（connect 成功で resolve）", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    spawnMock.mockReturnValue(createFakeChild());

    await expect(startOpencode(baseOptions)).resolves.toBeUndefined();
    // connect が呼ばれていること = waitForReady を通過した
    expect(connectMock).toHaveBeenCalled();
  });

  it("waitForReady が時間内に成功しなければ reject される", async () => {
    setupExecFileSuccess();
    setupFailingConnect();
    spawnMock.mockReturnValue(createFakeChild());

    await expect(
      startOpencode({ ...baseOptions, readyTimeoutMs: 200 })
    ).rejects.toThrow(/not ready/);
  });
});

describe("stopOpencode", () => {
  it("spawn 済み child があれば SIGTERM が送られる", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    const fc = createFakeChild();
    spawnMock.mockReturnValue(fc);

    await startOpencode(baseOptions);
    const stopPromise = stopOpencode();
    // 即座に exit イベントを発火させて resolve
    fc.exitCode = 0;
    fc.emit("exit", 0, null);
    await stopPromise;

    expect(fc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kill 猶予時間内に exit しなければ SIGKILL に昇格", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    const fc = createFakeChild();
    spawnMock.mockReturnValue(fc);

    // killTimeoutMs を短くしてテスト時間を抑える
    await startOpencode({ ...baseOptions, killTimeoutMs: 30 });
    const stopPromise = stopOpencode();
    // exit イベントを発火させない → 30ms 後に SIGKILL
    await stopPromise;

    expect(fc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("child が無ければ何もしない", async () => {
    await expect(stopOpencode()).resolves.toBeUndefined();
  });
});

describe("restartOpencode", () => {
  it("順序: opencode_restarting → stop → postprocess → spawn → ready → opencode_ready", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    const fc1 = createFakeChild();
    const fc2 = createFakeChild();
    spawnMock.mockReturnValueOnce(fc1).mockReturnValueOnce(fc2);

    await startOpencode(baseOptions);
    spawnMock.mockClear();
    execFileMock.mockClear();
    connectMock.mockClear();

    const restartPromise = restartOpencode();
    // 古い子の exit を即座に発火
    fc1.exitCode = 0;
    fc1.emit("exit", 0, null);
    await restartPromise;

    // broadcast の呼び出し順序
    expect(broadcastSystemMock).toHaveBeenNthCalledWith(1, "opencode_restarting");
    expect(broadcastSystemMock).toHaveBeenNthCalledWith(2, "opencode_ready");
    // stop → postprocess → spawn の順序
    expect(fc1.kill).toHaveBeenCalledWith("SIGTERM");
    expect(execFileMock).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalled();
  });

  it("途中で失敗しても restarting フラグは false に戻る", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    const fc1 = createFakeChild();
    spawnMock.mockReturnValueOnce(fc1);

    await startOpencode(baseOptions);

    // postprocess を失敗させる
    setupExecFileFailure(new Error("postprocess failed"));

    const stopThenFail = restartOpencode();
    fc1.exitCode = 0;
    fc1.emit("exit", 0, null);
    await expect(stopThenFail).rejects.toThrow();

    expect(isRestarting()).toBe(false);
  });

  it("opts 未初期化なら throw する", async () => {
    __resetForTest();
    await expect(restartOpencode()).rejects.toThrow(/not initialized/);
  });
});

describe("isRestarting", () => {
  it("平常時は false", () => {
    expect(isRestarting()).toBe(false);
  });

  it("restartOpencode 進行中は true、完了後 false", async () => {
    setupExecFileSuccess();
    setupSuccessfulConnect();
    const fc1 = createFakeChild();
    const fc2 = createFakeChild();
    spawnMock.mockReturnValueOnce(fc1).mockReturnValueOnce(fc2);

    await startOpencode(baseOptions);
    expect(isRestarting()).toBe(false);

    let observedDuring = false;
    // broadcastSystemMock が opencode_restarting で呼ばれた瞬間に isRestarting() を観測
    (broadcastSystemMock as MockedFunction<(e: string) => void>).mockImplementation(
      (e: string) => {
        if (e === "opencode_restarting") {
          observedDuring = isRestarting();
        }
      }
    );

    const p = restartOpencode();
    fc1.exitCode = 0;
    fc1.emit("exit", 0, null);
    await p;

    expect(observedDuring).toBe(true);
    expect(isRestarting()).toBe(false);
  });
});

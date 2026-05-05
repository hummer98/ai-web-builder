import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createLogger } from "./logger.js";

export interface Secrets {
  openrouter?: { apiKey: string };
  gemini?: { apiKey: string };
  cloudflare?: { apiToken: string; accountId: string };
  firebase?: { token: string };
}

export interface SecretStatus {
  openrouter: { set: boolean; last4?: string };
  gemini: { set: boolean; last4?: string };
  cloudflare: { set: boolean; last4?: string; accountId?: string };
  firebase: { set: boolean; last4?: string };
}

const log = createLogger("agent-server");

function resolveSecretsPath(): string {
  const fromEnv = process.env.SECRETS_FILE;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (existsSync("/data")) {
    return "/data/secrets.json";
  }
  return resolve(import.meta.dirname, "../../../data/secrets.json");
}

const SECRETS_PATH = resolveSecretsPath();

function last4(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(-4);
}

function cleanSecrets(s: Secrets): Secrets {
  const out: Secrets = {};
  if (s.openrouter && s.openrouter.apiKey) {
    out.openrouter = { apiKey: s.openrouter.apiKey };
  }
  if (s.gemini && s.gemini.apiKey) {
    out.gemini = { apiKey: s.gemini.apiKey };
  }
  if (s.cloudflare && s.cloudflare.apiToken && s.cloudflare.accountId) {
    out.cloudflare = {
      apiToken: s.cloudflare.apiToken,
      accountId: s.cloudflare.accountId,
    };
  }
  if (s.firebase && s.firebase.token) {
    out.firebase = { token: s.firebase.token };
  }
  return out;
}

export function loadSecrets(): Secrets {
  let raw: string;
  try {
    raw = readFileSync(SECRETS_PATH, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    log.error("secrets.json read failed", {
      path: SECRETS_PATH,
      errorName: err instanceof Error ? err.name : "unknown",
    });
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as Secrets;
    return cleanSecrets(parsed);
  } catch (err) {
    log.warn("secrets.json parse failed; starting with empty store", {
      path: SECRETS_PATH,
      errorName: err instanceof Error ? err.name : "unknown",
    });
    return {};
  }
}

export function saveSecrets(s: Secrets): void {
  const cleaned = cleanSecrets(s);
  const dir = dirname(SECRETS_PATH);
  const tmp = SECRETS_PATH + ".tmp";
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(cleaned, null, 2), { encoding: "utf-8" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, SECRETS_PATH);
  } catch (err) {
    log.error("secrets.json write failed", {
      path: SECRETS_PATH,
      errorName: err instanceof Error ? err.name : "unknown",
    });
    throw err;
  }
}

export function getStatus(): SecretStatus {
  const s = loadSecrets();
  const status: SecretStatus = {
    openrouter: { set: false },
    gemini: { set: false },
    cloudflare: { set: false },
    firebase: { set: false },
  };

  if (s.openrouter?.apiKey) {
    status.openrouter = { set: true, last4: last4(s.openrouter.apiKey) };
  }
  if (s.gemini?.apiKey) {
    status.gemini = { set: true, last4: last4(s.gemini.apiKey) };
  }
  if (s.cloudflare?.apiToken && s.cloudflare?.accountId) {
    status.cloudflare = {
      set: true,
      last4: last4(s.cloudflare.apiToken),
      accountId: s.cloudflare.accountId,
    };
  }
  if (s.firebase?.token) {
    status.firebase = { set: true, last4: last4(s.firebase.token) };
  }

  return status;
}

export function updateProvider<K extends keyof Secrets>(
  provider: K,
  value: Secrets[K] | null,
): void {
  const current = loadSecrets();
  if (value === null) {
    delete current[provider];
  } else {
    current[provider] = value;
  }
  saveSecrets(current);
}

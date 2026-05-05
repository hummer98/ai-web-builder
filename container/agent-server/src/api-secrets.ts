import { Hono } from "hono";
import { z } from "zod";
import {
  getStatus,
  loadSecrets,
  saveSecrets,
  type Secrets,
} from "./secrets-store.js";
import { createLogger } from "./logger.js";

const SecretsUpdateSchema = z.object({
  openrouter: z.object({ apiKey: z.string().min(1) }).optional(),
  gemini: z.object({ apiKey: z.string().min(1) }).optional(),
  cloudflare: z
    .object({
      apiToken: z.string().min(1),
      accountId: z.string().min(1),
    })
    .optional(),
  firebase: z.object({ token: z.string().min(1) }).optional(),
});

const ProviderEnum = z.enum(["openrouter", "gemini", "cloudflare", "firebase"]);

const PROVIDER_KEYS = [
  "openrouter",
  "gemini",
  "cloudflare",
  "firebase",
] as const satisfies ReadonlyArray<keyof Secrets>;

export interface SecretsRouterOpts {
  /**
   * openrouter / gemini が更新された場合に呼ばれる。
   * T018 で opencode 再起動関数を渡す予定。今回は未指定 (= no-op) で OK。
   */
  onSecretsChanged?: (
    providers: Array<keyof Secrets>,
  ) => void | Promise<void>;
}

export function createSecretsRouter(opts: SecretsRouterOpts = {}) {
  const log = createLogger("agent-server");
  const r = new Hono();

  r.get("/", (c) => c.json(getStatus()));

  r.put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = SecretsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      log.warn("secrets_invalid_request", {
        issuesCount: parsed.error.issues.length,
      });
      return c.json({ error: "invalid_request" }, 400);
    }

    const current = loadSecrets();
    const updatedKeys: Array<keyof Secrets> = [];
    for (const k of PROVIDER_KEYS) {
      const v = parsed.data[k];
      if (v !== undefined) {
        current[k] = v as never;
        updatedKeys.push(k);
      }
    }
    saveSecrets(current);

    if (updatedKeys.length > 0) {
      log.info("secrets_updated", { providers: updatedKeys });
      const restartProviders = updatedKeys.filter(
        (k) => k === "openrouter" || k === "gemini",
      );
      if (restartProviders.length > 0 && opts.onSecretsChanged) {
        try {
          await opts.onSecretsChanged(restartProviders);
        } catch (err) {
          log.warn("secrets_changed_hook_failed", {
            errorName: err instanceof Error ? err.name : "unknown",
          });
        }
      }
    }

    return c.json(getStatus());
  });

  r.delete("/:provider", async (c) => {
    const provider = ProviderEnum.safeParse(c.req.param("provider"));
    if (!provider.success) {
      return c.json({ error: "invalid_request" }, 404);
    }
    const current = loadSecrets();
    const existed = current[provider.data] !== undefined;
    delete current[provider.data];
    saveSecrets(current);
    if (existed) {
      log.info("secrets_updated", { providers: [provider.data] });
      if (
        (provider.data === "openrouter" || provider.data === "gemini") &&
        opts.onSecretsChanged
      ) {
        try {
          await opts.onSecretsChanged([provider.data]);
        } catch (err) {
          log.warn("secrets_changed_hook_failed", {
            errorName: err instanceof Error ? err.name : "unknown",
          });
        }
      }
    }
    return c.json(getStatus());
  });

  return r;
}

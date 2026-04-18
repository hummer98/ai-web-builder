import { z } from "zod";

const elementContextSchema = z
  .object({
    ocId: z.string().optional(),
    tag: z.string().optional(),
    text: z.string().optional(),
    classes: z.string().optional(),
    componentTree: z
      .array(z.object({ name: z.string(), file: z.string() }))
      .optional(),
  })
  .optional();

const chatSchema = z.object({
  type: z.literal("chat"),
  message: z.string().min(1),
  imageUrl: z.string().optional(),
  elementContext: elementContextSchema,
});

const undoSchema = z.object({ type: z.literal("undo") });

const historySchema = z.object({
  type: z.literal("history"),
  count: z.number().int().positive().max(500).optional(),
});

const revertSchema = z.object({
  type: z.literal("revert"),
  hash: z.string().regex(/^[0-9a-f]{4,40}$/i),
});

const deploySchema = z.object({ type: z.literal("deploy") });

const createSiteSchema = z.object({
  type: z.literal("create-site"),
  owner: z.string().min(1),
  siteName: z.string().min(1),
});

const importRepoSchema = z.object({
  type: z.literal("import-repo"),
  owner: z.string().min(1),
  repoName: z.string().min(1),
});

export const wsMessageSchema = z.discriminatedUnion("type", [
  chatSchema,
  undoSchema,
  historySchema,
  revertSchema,
  deploySchema,
  createSiteSchema,
  importRepoSchema,
]);

export type WsMessage = z.infer<typeof wsMessageSchema>;

export type ParseResult =
  | { ok: true; value: WsMessage }
  | { ok: false; reason: "invalid-json" | "invalid-shape"; detail: string };

export function parseWsMessage(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: "invalid-json", detail: String(err) };
  }

  const parsed = wsMessageSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid-shape",
      detail: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, value: parsed.data };
}

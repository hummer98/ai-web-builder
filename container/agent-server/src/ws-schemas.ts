import { z } from "zod";

const componentTreeItemSchema = z.object({
  name: z.string(),
  file: z.string(),
});

const elementContextSchema = z
  .object({
    ocId: z.string().optional(),
    tag: z.string().optional(),
    text: z.string().optional(),
    classes: z.string().optional(),
    componentTree: z.array(componentTreeItemSchema).optional(),
  })
  .partial();

export const chatMessageSchema = z.object({
  type: z.literal("chat"),
  message: z.string().min(1).max(8000),
  imageUrl: z.string().optional(),
  elementContext: elementContextSchema.optional(),
});

export const undoMessageSchema = z.object({
  type: z.literal("undo"),
});

export const historyMessageSchema = z.object({
  type: z.literal("history"),
  count: z.number().int().positive().max(200).optional(),
});

export const revertMessageSchema = z.object({
  type: z.literal("revert"),
  hash: z
    .string()
    .regex(/^[0-9a-f]{4,40}$/i, "hash must be a hex commit id"),
});

export const deployMessageSchema = z.object({
  type: z.literal("deploy"),
});

export const createSiteMessageSchema = z.object({
  type: z.literal("create-site"),
  owner: z.string().min(1).max(100),
  siteName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/u, "siteName must be a slug"),
});

export const importRepoMessageSchema = z.object({
  type: z.literal("import-repo"),
  owner: z.string().min(1).max(100),
  repoName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/u, "repoName must be a slug"),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  chatMessageSchema,
  undoMessageSchema,
  historyMessageSchema,
  revertMessageSchema,
  deployMessageSchema,
  createSiteMessageSchema,
  importRepoMessageSchema,
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export function parseWsClientMessage(
  raw: unknown
):
  | { ok: true; data: WsClientMessage }
  | { ok: false; reason: string } {
  const result = wsClientMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path.join(".") ?? "(root)";
  return { ok: false, reason: `${path}: ${first?.message ?? "invalid"}` };
}

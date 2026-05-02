import { z } from "zod";

const sha = z.string().regex(/^[0-9a-f]{4,40}$/);
const repoIdent = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);

const ElementContext = z
  .object({
    ocId: z.string().max(200).optional(),
    tag: z.string().max(50).optional(),
    text: z.string().max(2000).optional(),
    classes: z.string().max(2000).optional(),
    componentTree: z
      .array(
        z.object({
          name: z.string().max(200),
          file: z.string().max(500),
        })
      )
      .max(20)
      .optional(),
  })
  .optional();

export const ChatMsg = z.object({
  type: z.literal("chat"),
  message: z.string().max(20000),
  imageUrl: z.string().max(2000).optional(),
  elementContext: ElementContext,
});

export const UndoMsg = z.object({
  type: z.literal("undo"),
});

export const HistoryMsg = z.object({
  type: z.literal("history"),
  count: z.number().int().min(1).max(100).optional(),
});

export const RevertMsg = z.object({
  type: z.literal("revert"),
  hash: sha,
});

export const DeployMsg = z.object({
  type: z.literal("deploy"),
});

export const CreateSiteMsg = z.object({
  type: z.literal("create-site"),
  // owner はサーバー側で固定するため受け取っても無視される
  owner: z.string().optional(),
  siteName: repoIdent,
});

export const ImportRepoMsg = z.object({
  type: z.literal("import-repo"),
  owner: z.string().optional(),
  repoName: repoIdent,
});

// discriminatedUnion 配下の z.object はデフォルトの .strip() でよい。
// 不正フィールドはスキーマ通過時に剥がされ、ハンドラには到達しないので無害。
export const WsInbound = z.discriminatedUnion("type", [
  ChatMsg,
  UndoMsg,
  HistoryMsg,
  RevertMsg,
  DeployMsg,
  CreateSiteMsg,
  ImportRepoMsg,
]);

export type WsInboundMessage = z.infer<typeof WsInbound>;

export type ParseResult =
  | { ok: true; data: WsInboundMessage }
  | { ok: false; error: string };

export function parseWsMessage(raw: unknown): ParseResult {
  const result = WsInbound.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const first = result.error.issues[0];
  const path = first?.path.join(".") || "(root)";
  const msg = first?.message ?? "Invalid message";
  return { ok: false, error: `${path}: ${msg}` };
}

export const REPO_IDENT_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;
export const SHA_REGEX = /^[0-9a-f]{4,40}$/;

/**
 * 友人向けエラーメッセージ。siteName/repoName が不正な場合に使う。
 */
export const INVALID_NAME_MESSAGE =
  "サイト名は英数字とハイフンで指定してください (例: my-cafe-site)";

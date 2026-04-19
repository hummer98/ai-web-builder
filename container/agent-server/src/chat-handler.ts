import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk";
import { buildPrompt } from "./utils.js";
import { buildImagePart } from "./image-part.js";
import { createLogger } from "./logger.js";

/** timeout.ts の InactivityTimer と構造互換で受け取る */
export type TimerLike = { reset: () => void; stop: () => void };

const log = createLogger("chat-handler");

/** 180 秒 SSE 無イベント時に発火させる処理 (M1/M2 対応):
 * 1. ws に type:"error" を送る (editor 側 ChatPanel の error 分岐で即表示される)
 * 2. opencode.session.abort を await せず発火
 * 3. sessionId を undefined にリセットし、次回 chat で session.create から再開
 */
export function runInactivityTimeout(ctx: {
  opencode: ReturnType<typeof createOpencodeClient>;
  ws: { send: (data: string) => void };
  getSessionId: () => string | undefined;
  setSessionId: (id: string | undefined) => void;
}): void {
  const sessionId = ctx.getSessionId();
  ctx.ws.send(
    JSON.stringify({
      type: "error",
      message: "AI の応答が 3 分間ありませんでした。もう一度送ってください。",
    })
  );
  if (sessionId) {
    ctx.opencode.session.abort({ path: { id: sessionId } }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error("session.abort failed", { message });
    });
  }
  ctx.setSessionId(undefined);
  log.info("inactivity timeout fired", { sessionId });
}

export type ChatMessageData = {
  type: "chat";
  message: string;
  imageUrl?: string;
  elementContext?: {
    ocId?: string;
    tag?: string;
    text?: string;
    classes?: string;
    componentTree?: { name: string; file: string }[];
  };
};

export type ChatHandlerCtx = {
  opencode: ReturnType<typeof createOpencodeClient>;
  ws: { send: (data: string) => void };
  workspaceDir: string;
  getSessionId: () => string | undefined;
  setSessionId: (id: string | undefined) => void;
  /** timeout 対応用（Step 3 で注入）。 */
  timer?: TimerLike;
};

/**
 * chat 分岐ロジックを純粋寄りの関数として抽出したもの。
 *
 * - onMessage のクロージャから `opencode / ws / sessionId` を ctx 経由で受け取る
 * - session.test.ts から OpenCode client をモック差し替えで呼べるようにするための設計
 *   (M3 対応)
 */
export async function handleChatMessage(
  data: ChatMessageData,
  ctx: ChatHandlerCtx
): Promise<void> {
  try {
    if (!ctx.getSessionId()) {
      const res = await ctx.opencode.session.create();
      const session = (res as { data?: { id: string }; id?: string }).data ?? res;
      const id = (session as { id: string }).id;
      log.info("OpenCode session created", { sessionId: id });
      ctx.setSessionId(id);
    }

    const currentSessionId = ctx.getSessionId();
    if (!currentSessionId) {
      throw new Error("sessionId unresolved after session.create");
    }

    ctx.ws.send(JSON.stringify({ type: "status", message: "thinking" }));

    const prompt = buildPrompt(data);
    const parts: Array<TextPartInput | FilePartInput> = [
      { type: "text", text: prompt },
    ];
    if (data.imageUrl) {
      const imagePart = await buildImagePart(data.imageUrl, ctx.workspaceDir);
      parts.push(imagePart);
    }

    // タイマー起動（promptAsync 送信直前に仕掛ける）
    ctx.timer?.reset();

    await ctx.opencode.session.promptAsync({
      path: { id: currentSessionId },
      body: { parts },
    });
    log.info("promptAsync sent", {
      sessionId: currentSessionId,
      partCount: parts.length,
      hasImage: Boolean(data.imageUrl),
    });
  } catch (err) {
    // data URL 本体がログやユーザーメッセージに流れるのを避けるため、err.message のみ扱いつつ
    // `data:<mime>;base64,<...>` 片をマスクする (m2 対応)
    const raw = err instanceof Error ? err.message : "Unknown error";
    const message = raw.replace(
      /data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g,
      "[data URL omitted]"
    );
    ctx.timer?.stop();
    log.error("chat handler failed", { message });
    ctx.ws.send(
      JSON.stringify({ type: "error", message: `AI error: ${message}` })
    );
  }
}

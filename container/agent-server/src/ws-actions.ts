import { autoPush, undoLastCommit } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createLogger } from "./logger.js";
import { sanitizeError } from "./utils.js";
import { sendOutbound, type WSOutboundMessage } from "./ws-outbound.js";

const log = createLogger("agent-server");

type WSSender = { send: (data: string) => void };

/**
 * undo を実行し、レスポンスを {type:"git", action:"undo"} 形式で送る。
 * handleCommand と handleMessage の両経路から呼ばれ、レスポンス形式を統一する。
 */
export async function executeUndo(ws: WSSender): Promise<void> {
  try {
    const hash = undoLastCommit();
    if (hash) {
      sendOutbound(ws, {
        type: "git",
        action: "undo",
        message: `変更を元に戻しました (${hash})`,
        hash,
      });
      log.info("Undo completed", { hash });
      autoPush().catch((err) =>
        log.error("Push after undo failed", { error: sanitizeError(err) })
      );
    } else {
      sendOutbound(ws, { type: "error", message: "元に戻す変更がありません" });
    }
  } catch (err) {
    log.error("Undo failed", { error: sanitizeError(err) });
    sendOutbound(ws, {
      type: "error",
      message: `元に戻す操作に失敗しました: ${sanitizeError(err)}`,
    });
  }
}

/**
 * deploy を実行し、レスポンスを {type:"deploy", success:bool} 形式で送る。
 */
export async function executeDeploy(ws: WSSender, siteDomain: string): Promise<void> {
  log.info("Deploy requested", { siteName: siteDomain });
  sendOutbound(ws, { type: "status", message: "deploying" });
  try {
    const result = await deploy(siteDomain);
    const msg: WSOutboundMessage = result.success
      ? { type: "deploy", success: true, url: result.pagesUrl }
      : { type: "deploy", success: false, error: result.error };
    sendOutbound(ws, msg);
  } catch (err) {
    log.error("Deploy failed", { error: sanitizeError(err) });
    sendOutbound(ws, {
      type: "deploy",
      success: false,
      error: sanitizeError(err),
    });
  }
}

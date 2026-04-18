import type { Command } from "./utils.js";
import { HELP_TEXT } from "./utils.js";
import { undoLastCommit, autoPush, type AutoPushResult } from "./git-ops.js";
import { deploy } from "./deploy.js";
import { createNewSite, importExistingRepo, resetWorkspace } from "./site-init.js";

export type WsLike = { send: (data: string) => void };

/**
 * autoPush の結果をユーザーに通知する。
 * 失敗時: "warning" 型で WS メッセージを送信する（UI 側でトースト等を表示できるよう）。
 * not-configured はローカル開発時の通常ケースなので通知しない。
 */
export function notifyPushResult(
  result: AutoPushResult,
  context: "edit" | "undo" | "revert",
  ws: WsLike
): void {
  if (result.ok) return;
  if (result.reason === "not-configured") return;
  const contextLabel = { edit: "変更", undo: "取り消し", revert: "復元" }[context];
  ws.send(
    JSON.stringify({
      type: "warning",
      code: "push-failed",
      message: `${contextLabel}のバックアップに失敗しました。次回の変更時に自動で再試行されます。`,
    })
  );
}

/**
 * 検出されたコマンドを実行し、結果を WebSocket で送信する。
 */
export async function handleCommand(
  cmd: Command,
  ws: WsLike,
  opts: { siteName: string; defaultOwner: string }
): Promise<void> {
  switch (cmd.type) {
    case "undo": {
      ws.send(JSON.stringify({ type: "status", message: "undoing" }));
      const hash = undoLastCommit();
      if (hash) {
        autoPush().then((result) => notifyPushResult(result, "undo", ws));
        ws.send(
          JSON.stringify({
            type: "response",
            message: `変更を元に戻しました (commit: ${hash})`,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "元に戻せる変更がありませんでした",
          })
        );
      }
      break;
    }

    case "deploy": {
      ws.send(JSON.stringify({ type: "status", message: "deploying" }));
      const result = await deploy(opts.siteName);
      if (result.success) {
        ws.send(
          JSON.stringify({
            type: "response",
            message: result.pagesUrl
              ? `サイトを公開しました！\n${result.pagesUrl}`
              : "サイトを公開しました！",
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `公開に失敗しました: ${result.error}`,
          })
        );
      }
      break;
    }

    case "create": {
      ws.send(JSON.stringify({ type: "status", message: "creating" }));
      try {
        const result = await createNewSite(opts.defaultOwner, cmd.siteName);
        if (result.success) {
          ws.send(
            JSON.stringify({
              type: "site-init",
              action: "created",
              repoUrl: result.repoUrl,
            })
          );
        } else {
          ws.send(JSON.stringify({ type: "error", message: result.error }));
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `サイト作成に失敗しました: ${err}`,
          })
        );
      }
      break;
    }

    case "help": {
      ws.send(
        JSON.stringify({
          type: "response",
          message: HELP_TEXT,
        })
      );
      break;
    }

    case "import": {
      ws.send(JSON.stringify({ type: "status", message: "importing" }));
      try {
        const result = await importExistingRepo(opts.defaultOwner, cmd.repoName);
        if (result.success) {
          ws.send(
            JSON.stringify({
              type: "site-init",
              action: "imported",
              repoUrl: result.repoUrl,
            })
          );
        } else {
          ws.send(JSON.stringify({ type: "error", message: result.error }));
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `リポジトリ取り込みに失敗しました: ${err}`,
          })
        );
      }
      break;
    }

    case "reset": {
      ws.send(JSON.stringify({ type: "status", message: "resetting" }));
      const result = await resetWorkspace();
      if (result.success) {
        ws.send(
          JSON.stringify({
            type: "response",
            message: "ワークスペースを初期状態にリセットしました",
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `リセットに失敗しました: ${result.error}`,
          })
        );
      }
      break;
    }
  }
}

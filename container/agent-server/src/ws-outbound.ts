/**
 * サーバー → ブラウザの WebSocket 送信メッセージ型 (discriminated union)。
 *
 * 同期要件: editor/src/types/ws-outbound.ts と手動で同期すること。
 *  - 型を追加・変更したら editor 側にも同じ変更を反映する
 *  - フィールド名・必須/任意を揃える
 *  - サーバー側で型 A を送るのに editor 側で A が定義されていないと実行時にハンドラが落ちる
 */

export type Commit = {
  hash: string;
  message: string;
  date: string;
};

/** opencode の question ツールが提示する 1 つの選択肢。 */
export type QuestionOption = {
  label: string;
  description: string;
};

/** opencode の question ツールが提示する 1 問。 */
export type QuestionItem = {
  question: string;
  header: string;
  options: QuestionOption[];
  /** 複数選択可なら true。 */
  multiple?: boolean;
  /** 自由入力 (その他) を許すなら true。 */
  custom?: boolean;
};

export type WSOutboundMessage =
  | { type: "stream"; delta: string }
  | { type: "stream-end" }
  | { type: "status"; message: string }
  | { type: "response"; message: string }
  | { type: "error"; message: string }
  | { type: "file-changed" }
  | { type: "git"; action: "undo" | "commit" | "revert"; message?: string; hash?: string }
  | { type: "history"; commits: Commit[] }
  | { type: "deploy"; success: true; url?: string }
  | { type: "deploy"; success: false; error?: string }
  | { type: "site-init"; action: "created" | "imported"; repoUrl?: string }
  | { type: "warning"; message: string; reasons?: string[] }
  | { type: "site-brief"; content: string; isEmpty: boolean }
  | { type: "site-brief-saved"; hash?: string }
  | { type: "system"; event: "opencode_restarting" | "opencode_ready" }
  | { type: "question"; requestId: string; questions: QuestionItem[] };

/**
 * 型安全な send ヘルパー。WSOutboundMessage 以外を渡すと TypeScript エラー。
 */
export function sendOutbound(
  ws: { send: (data: string) => void },
  msg: WSOutboundMessage
): void {
  ws.send(JSON.stringify(msg));
}

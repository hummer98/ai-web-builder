/**
 * サーバー → ブラウザの WebSocket 受信メッセージ型 (discriminated union)。
 *
 * 同期要件: container/agent-server/src/ws-outbound.ts と手動で同期すること。
 *  - editor と agent-server は別 npm パッケージで型を直接 import できないため
 *    両ファイルで同一の型を定義している
 *  - 型を追加・変更したら両側に同じ変更を入れる
 *  - サーバーが新しい type を送ってきても editor が知らなければ default 落ちで無視される
 */

export type Commit = {
  hash: string;
  message: string;
  date: string;
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
  | { type: "site-init"; action: "created" | "imported"; repoUrl?: string };

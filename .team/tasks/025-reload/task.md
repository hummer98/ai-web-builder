---
id: 025
title: 編集ヘッダーを右ペインに集約 + Reload をアイコン化
priority: high
depends_on: [024]
created_by: surface:63
created_at: 2026-05-07T23:27:53.374Z
---

## タスク
## 背景

現状のエディタは左右 2 ペイン構成:

- 左ペイン (ChatPanel): ヘッダーに `📝 サイト情報` `? 使い方` `⚙ 設定` `📋 履歴` `↩ 元に戻す` `🚀 公開` の 6 ボタン
- 右ペイン (PreviewPanel): ヘッダーに `← → 🏠` `Inspect` `Desktop/Tablet/Mobile` `Reload (テキスト)` のツールバー

ユーザー要望:

1. 左ペインのヘッダーにある 6 ボタンを **すべて右ペインのヘッダーに移動** する
2. `公開` ボタンは右ペインヘッダーの **一番右** に配置する
3. `Reload` は **🏠（ホーム）の右隣** に配置し、**テキストではなくアイコン**（例: ↻ や 🔄 等の Unicode 文字）に変える

これにより、左ペインはチャット入力に専念し、サイト操作系は右ペイン（プレビュー側）に集約される。

## 影響ファイル

- `editor/src/components/ChatPanel.tsx` — ヘッダーから 6 ボタン削除、関連 state/handler を上に持ち上げ
- `editor/src/components/PreviewPanel.tsx` — ヘッダーを再構成、Reload アイコン化
- `editor/src/App.tsx` — state 持ち上げ先 / 履歴モーダル設置場所
- `editor/src/components/ChatPanel.test.tsx` / 新規 `PreviewPanel.test.tsx` — テスト更新

## 設計方針

### 状態の持ち上げ

ChatPanel 内に閉じている以下を `App.tsx` に持ち上げ、`PreviewPanel` に props として渡す:

- `deploying: boolean`（`deploy-status` で update）
- `undoing: boolean`（`undo-result` で update）
- `historyOpen: boolean` と履歴データ
- `handleDeploy()` / `handleUndo()` / `handleHistory()` 関数
- WebSocket の `deploy-status` / `undo-result` / `history-list` メッセージ受信ハンドリング

代替案として「状態管理は ChatPanel に残し、props で公開する」も可だが、責務分離が不明瞭になるので **App.tsx 集約** を推奨。

### 履歴モーダル

`ChatPanel.tsx:620` 付近で render している履歴モーダルは `App.tsx` に移動する
（`SettingsDialog` / `SiteBriefModal` と同列で配置）。

### ヘッダーレイアウト（右ペイン、左→右）

\`\`\`
[←] [→] [🏠] [↻ Reload] | [Inspect] | [Desktop] [Tablet] [Mobile]
   ... [📝 サイト情報] [? 使い方] [⚙ 設定] [📋 履歴] [↩ 元に戻す]   [🚀 公開]
\`\`\`

実際は 1 行に収まらない可能性が高いので、CSS で wrap 許可 or 横スクロール可とする。
推奨: \`flex-wrap: wrap\` + \`gap-2\`、`公開` のみ \`ml-auto\` で右端に押し出す
（ただし wrap した場合の挙動を確認すること）。

### Reload のアイコン

- 現状: \`Reload\` テキスト + \`ml-auto\`（PreviewPanel.tsx:166-171）
- 変更後:
  - 位置: 🏠 の右隣
  - 表記: アイコンのみ（\`↻\` U+21BB か \`🔄\` U+1F504）。他のナビボタン（\`←\` \`→\` \`🏠\`）と統一感を出す
  - \`aria-label="再読み込み"\` を必ず付与
  - \`title="再読み込み"\` も付ける
- ML-auto は廃止し、その役割は `公開` ボタンに移す（\`公開` を一番右に配置するため）

### ChatPanel の props

ChatPanel から以下の props を削除:

- \`onHelp\`, \`onOpenSiteBrief\`, \`onOpenSettings\`
- \`cloudflareReady\`, \`firebaseReady\`
- \`disabledReason\` は引き続き必要（チャット入力 disabled 制御に使う）

### PreviewPanel の props 追加

- \`connected: boolean\`
- \`disabledReason: string | null\`
- \`onSend: (msg: any) => void\`（公開・元に戻す・履歴取得）
- \`onOpenSiteBrief: () => void\`
- \`onOpenSettings: () => void\`
- \`onOpenHelp: () => void\`
- \`onOpenHistory: () => void\`
- \`undoing: boolean\`, \`deploying: boolean\`
- \`cloudflareReady: boolean\`, \`firebaseReady: boolean\`

## 受け入れ条件

1. ローカル開発 (\`npm run dev\`) で editor を開いたとき:
   - 左ペイン上部にはチャット接続ステータス（緑/赤ドット + サイト名）と入力欄のみ
   - 右ペイン上部に 6 ボタン + 既存ナビ + Reload アイコンが揃って表示される
   - \`公開\` ボタンが右ペインヘッダーの最右端
   - \`Reload\` は 🏠 の右隣にあり、アイコン表示（例: ↻）
2. \`公開\` クリック → デプロイ進行表示 → \`公開中...\` ラベル → 完了 or エラーメッセージがチャットに流れる（既存挙動維持）
3. \`元に戻す\` クリック → \`戻し中...\` 表示 → 結果がチャットに流れる（既存挙動維持）
4. \`履歴\` クリック → 履歴モーダル開く → 過去状態に復元できる（既存挙動維持）
5. \`設定\` \`サイト情報\` \`使い方\` クリック → それぞれモーダルが開く（既存挙動維持）
6. \`disabledReason\` が立っているとき:
   - \`元に戻す\` \`履歴\` \`公開\` は disabled
   - \`公開\` でクラウドキー未登録時は \`onOpenSettings\` が呼ばれる（既存挙動）
7. \`vitest\` 全 pass。\`ChatPanel.test.tsx\` の既存テストは修正、`PreviewPanel.test.tsx` は新規でヘッダーボタンの呼び出し検証を追加
8. \`npm run dev\` 起動して手動でクリック確認した結果を summary.md に記録

## 注意

- T024 の修正（戻る/進むボタンの自前履歴管理）と PreviewPanel.tsx で **同じファイルを触る** ため、本タスクは \`--depends-on 024\` で起票している
- T024 が closed → main に merge → 本タスクの worktree が最新の main から切られる、という順序で安全に実行される
- ヘッダー幅が足りない場合の wrap 挙動は手動確認すること（横幅 1280px 程度で切れない位置にすべきボタンを置く）
- \`公開\` ボタンの emerald カラーは維持。他のグレーボタンとの差別化が UI 上重要

# Implementation Tasks

## Task 1: AI プロンプト改善 (Issue #27) (P)

### 概要
AI がサイトを十分に生成するよう、OPENCODE.md とプロンプト構築を改善する。

### 作業内容
1. `container/scaffold/OPENCODE.md` に「サイト生成の手順」セクションを追加:
   - 新規サイト生成時は必ず複数のセクションコンポーネントを作成する
   - 各コンポーネントは `src/components/` に配置
   - `src/pages/Home.tsx` にコンポーネントを並べる
   - 具体的なコード例を示す

2. `container/scaffold/src/pages/Home.tsx` を改善:
   - コメントで「ここにセクションを追加」のガイドを入れる

3. `container/agent-server/src/utils.ts` の `buildPrompt` を改善:
   - scaffold の初期状態（AI Web Builder — Ready）を検知したら
   - 「サイト全体を生成してください。複数のコンポーネントファイルを作成し...」というコンテキストを追加

### テスト
- buildPrompt のテストを追加（scaffold 検知ロジック）
- 既存テストが通ることを確認

### 完了条件
- OPENCODE.md にサイト生成ガイドが追加されている
- テストが通る

### Status: pending

## Task 2: プレビュー HMR 修正 (Issue #28) (P)

### 概要
AI がファイルを編集した後、プレビュー iframe の表示が自動更新されるようにする。

### 作業内容
1. デモサイトの Vite ログを確認:
   - `fly ssh console -a ai-web-builder-demo -C "cat /app/logs/vite.log"` で HMR 状態確認
   - Vite が OpenCode のファイル編集を watch しているか

2. 原因に応じて修正:
   - **Vite HMR が動いていない場合**: vite.config.ts の server.watch 設定を調整
   - **HMR は動いているが iframe に反映されない場合**: iframe の HMR WebSocket 接続を確認
   - **根本的に HMR が効かない場合**: Agent Server の stream-end イベント時に iframe リロードメッセージを送信

3. フォールバック: AI 応答完了時に PreviewPanel が iframe を自動リロード:
   - ChatPanel の `stream-end` メッセージ受信時に iframe reload をトリガー
   - PreviewPanel に `reloadRequested` prop を追加

### テスト
- 既存テストが通ることを確認

### 完了条件
- AI がファイルを編集 → プレビューが自動更新される

### Status: pending

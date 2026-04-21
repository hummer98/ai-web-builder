---
id: 008
title: demo サイトで画像アップロード改修の動作確認
priority: high
depends_on: [007]
created_by: surface:289
created_at: 2026-04-19T14:41:57.680Z
---

## タスク
## 背景

T006 で実装し T007 で demo にデプロイした画像アップロードハング対応の改修が、実際に demo サイトで期待通り動作するかを確認する。

## 前提

- T007 で demo (ai-web-builder-demo) に改修が deploy 済み
- **絶対に触らないこと**: 本番アプリ `ai-web-builder`
- 非エンジニアペルソナ（CLAUDE.md）に沿ったプロンプトで検証する

## 手順

### 1. 再現テスト

T005 と同条件で画像アップロードを試す:

1. demo の URL にブラウザでアクセス（`https://ai-web-builder-demo.fly.dev/`、認証が必要な場合は T005 で特定済み）
2. 適当な画像（PNG 推奨、1MB 以下。`/tmp/test-hero.png` 等に用意）を添付
3. 非エンジニアペルソナのプロンプト送信: 例「この画像をトップのヒーローにして」
4. 並行して `flyctl logs -a ai-web-builder-demo` を tail

### 2. 期待される動作

- SSE イベント（`message.part.delta` 等）が WS 経由でフロントに届く
- OpenCode が実際にファイル編集を行う（`src/pages/Home.tsx` 等に `<img src=\"/uploads/<filename>\">` が挿入される）
- プレビューに画像が表示される
- チャットに進捗メッセージが表示される

### 3. 改修 D（deadline/timeout）の検証

D を採用した場合、意図的にハングするケース（例: 不正な imageUrl を送る、OpenCode を stall させる）を作って、timeout が発火して WS クライアントにタイムアウトメッセージが届くか確認する。

### 4. 回帰チェック

画像なしの通常プロンプト（例: 「背景色を青にして」）も動作することを確認。

## 成果物

`.team/output/T008-report.md`:
- 再現テストの結果（ハング解消 / 改善 / 変化なし / 悪化）
- 観察した SSE イベントの種類と順序
- プレビューに画像が反映されたか（スクリーンショット推奨）
- 採用された改修（A-E）ごとの効果検証
- 残課題（あれば次タスクの提案）
- `flyctl logs` の関連箇所抜粋

## 失敗時の対応

- 改修が期待通り動作しない場合、新しいタスク（調査 or 追加改修）を `cmux-team create-task` で提案
- **勝手に追加の改修を実装して deploy しない**（必ず Master/ユーザーに報告してから）

## 禁止事項

- `ai-web-builder`（le-serpent 本番）への一切のアクセス（閲覧も含めて不要）
- 動作に失敗した場合の本番デプロイによる切り戻し

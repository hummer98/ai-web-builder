---
id: 005
title: demo で画像アップロード 4 分ハングの再現と原因特定
priority: high
created_by: surface:289
created_at: 2026-04-19T14:34:43.099Z
---

## タスク
## 背景

ai-web-builder-demo にて画像添付 + プロンプト送信を行うと、OpenCode が SSE イベントを返さないまま約 4 分ハングする事象が発生している。真因が不明なため、ログ観察を伴う再現調査を行う。

設計済みの改修案 A-E（buildPrompt 強化、AGENTS.md 追記、promptAsync の multimodal 化、deadline/timeout、public/uploads 統合）はあるが、**真因を特定してから着手**する。

## 前提・制約

- **絶対に触らないこと**: 本番アプリ `ai-web-builder`（le-serpent.club 用、友人が運用中）
  - `flyctl deploy -a ai-web-builder` や `fly.toml` での deploy は禁止
  - 本タスクは必ず `-a ai-web-builder-demo` または `-c fly.demo.toml` を指定
- main HEAD は `fa342ed`（GitHub Actions で ai-web-builder には既に配布済み）
- `demo` の最終リリースは Mar 23 2026 (v38) で古く、`f7dba26` (opencode/vite/hono ログを Fly stdout に tee) を含んでいない
- `demo` は `SITE_DOMAIN` 未設定で scaffold の空ワークスペースで起動する
- workspace は Fly Volume (`workspace_data` → `/data/workspace`) にマウント。前回のテストデータが残っている可能性あり

## タスクの流れ

### 1. demo のデプロイ

```bash
flyctl deploy -c fly.demo.toml
```

- イメージビルド完了 → v39 以降のリリースが complete になることを確認
- `flyctl status -a ai-web-builder-demo` でマシンが started になるのを確認

### 2. demo のエンドポイントと認証情報を特定

- URL: `https://ai-web-builder-demo.fly.dev/`（または custom domain があれば）
- 認証: `DEMO_PASSWORD` が Fly secret に設定されていれば Basic 認証。`flyctl secrets list -a ai-web-builder-demo` で有無を確認
- 認証が必要で値が不明な場合は Master に確認

### 3. ログ観察の準備

別ターミナルで以下を tail しておく:

```bash
flyctl logs -a ai-web-builder-demo
```

agent-server 行は JSON Lines、opencode/vite/hono はプレーンテキスト。特に opencode 行の MCP 初期化（playwright, log-reader, nano-banana）と、LLM 呼び出し後の挙動を注視する。

### 4. 画像アップロードの再現

ブラウザ（Chrome MCP でも良い）で demo にアクセスし、以下を実行:

1. エディター UI を開く（チャットパネルが表示される）
2. 適当な画像（PNG 推奨、1MB 以下）を添付
3. 非エンジニアペルソナのプロンプトを送信: 例「この画像をトップのヒーローにして」
4. 送信後、SSE イベントが返るか、4 分ハングするかを観察

テスト画像は `/tmp/test-hero.png` 等に用意する（ImageMagick `convert -size 800x600 xc:lightblue /tmp/test-hero.png` など）。

### 5. ログから真因を特定

観察ポイント:

- **MCP 初期化で stall しているか**: playwright MCP は Chromium 起動、nano-banana は npx 経由で取得するため初期化に時間がかかる。「MCP server 'playwright' started」「MCP server 'nano-banana' started」のようなログが送信前に出ているか、送信後に出ているか
- **Claude (OpenRouter) 呼び出しが走っているか**: opencode の出力に LLM 呼び出しの痕跡があるか
- **相対 URL `/uploads/<uuid>.<ext>` を Claude が fetch しようとして失敗しているか**: curl/http_fetch などの痕跡、エラーメッセージ
- **Claude 側で何らかの判断ループに入っていないか**: tool call を連打しているなど

### 6. 調査レポート

以下を `.team/output/T<id>-report.md` として書き出す:

- 再現したか / しなかったか（した場合はハング時間）
- opencode ログの生データ抜粋（関連箇所 30-100 行程度）
- 真因の推定と根拠
- 改修案 A-E のうち真因に直接効くもの、優先度変更の提案
- 追加で必要な調査があればそれ

## 成果物

1. `.team/output/T<id>-report.md` — 上記の調査レポート
2. 追加で新しい知見（e.g. MCP 設定に問題がある、nano-banana の取得に失敗する等）があれば記述

## 禁止事項

- **`ai-web-builder`（le-serpent 本番）への一切の変更** — deploy, secrets, ssh での書き込みすべて禁止
- コードの改修（A-E）は本タスクの範囲外。真因特定までで止めること
- `flyctl ssh console -a ai-web-builder` も実行しない（`-a ai-web-builder-demo` のみ）

## 参考

- `container/start.sh`:84-94 — 4 プロセスの起動方法（`f7dba26` で tee 対応）
- `container/agent-server/src/index.ts`:117-122 — promptAsync 呼び出し
- `container/agent-server/src/utils.ts`:42-47 — buildPrompt の imageUrl 埋め込み
- `container/scaffold/opencode.json` — MCP 設定（playwright, log-reader, nano-banana）
- `CLAUDE.md` — ログ方針、テスト方針、セキュリティガイドライン

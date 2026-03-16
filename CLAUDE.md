# AI Web Builder

非エンジニア（友人）向けの AI 駆動 WYSIWYG Web サイト構築ツール。商用サービス展開は想定しない。

## 技術スタック

- **編集環境:** Fly.io (Fly Machines + Fly Volumes, Auto Start/Stop)
- **本番ホスティング:** Cloudflare (Pages + Workers + D1)
- **フロントエンド:** React + Tailwind CSS
- **バックエンド:** Hono (開発: Node.js / 本番: Cloudflare Workers)
- **DB:** Cloudflare D1 (SQLite 互換)
- **AI Agent:** OpenCode サーバーモード (`opencode serve :4096`)
- **LLM:** OpenRouter 経由 (Gemini 3.1 Pro / GPT-5.2-Codex / Kimi K2.5 等)
- **GitHub 連携:** GitHub App (`ai-web-builder[bot]`) による自動コミット・issue 操作

## リポジトリ構成

2つのリポジトリで構成:

1. **ai-web-builder** (このリポジトリ) — ビルダーツール本体
2. **ゲストリポジトリ** (友人ごとに1つ) — AI が編集する React + Hono サイト

```
ai-web-builder/
├── editor/                エディター UI (チャット + Iframe シェル)
├── container/             コンテナ内ランタイム
│   ├── agent-server/      WebSocket 受付 → opencode serve 橋渡し
│   └── scaffold/          ゲストサイトの初期ファイル一式
├── docs/                  設計ドキュメント
├── Dockerfile             コンテナイメージ定義
└── fly.toml               Fly.io 設定
```

## コンテナ内プロセス

| プロセス | ポート | 役割 |
|---------|-------|------|
| Agent Server | :8080 | ブラウザ WebSocket ↔ OpenCode 橋渡し |
| `opencode serve` | :4096 | AI 編集エンジン (ファイル編集・LSP・Git) |
| Vite Dev Server | :5173 | フロントエンド HMR |
| Hono Dev Server | :3000 | バックエンド API (tsx watch) |

## ローカル開発

```bash
direnv allow    # .envrc のシークレット読み込み
npm run dev     # 4プロセス並列起動
```

## ログ

全プロセスのログは `logs/` に JSON Lines 形式で出力。共通フィールド: `ts`, `level`, `service`, `msg`

```
logs/
├── agent-server.log
├── opencode.log
├── vite.log
├── hono.log
└── deploy.log
```

## AI フィードバックループ (必須)

OpenCode は編集後に Playwright MCP で視覚検証を行う:
1. 静的解析 (LSP / Lint)
2. スクリーンショット取得 → LLM が視覚確認
3. ブラウザコンソール・ログファイル確認 → ランタイムエラー検知

## シークレット

`.envrc` に格納 (gitignore 済み)。本番は Fly Secrets。

- `OPENROUTER_API_KEY` — LLM API
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — デプロイ
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` — GitHub App

## 設計方針

- 過剰設計しない (友人向け個人ツール)
- アンチ・ロックイン (実コード出力、GitHub にバックアップ)
- テンプレート不要 (初回は AI がゼロから生成)

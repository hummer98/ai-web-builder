# AI Web Builder

非エンジニア（友人）向けの AI 駆動 WYSIWYG Web サイト構築ツール。商用サービス展開は想定しない。

## ユーザーペルソナ（最重要）

**ユーザーは非エンジニアの友人。** 全ての設計・実装・テストの判断はこの前提に基づく。

- HTML/CSS/React/Git を知らない
- 「ファイル名」「コンポーネント」「デプロイ」という言葉を使わない
- 指示は曖昧で短い: 「おしゃれなカフェのサイトを作って」「この色を変えて」「もっといい感じにして」
- 技術的な詳細は一切見せない。結果だけ見せる
- 操作に迷ったら諦める。ヘルプを読まない前提で UI を設計する

**テストやデモのプロンプトもこのペルソナで書くこと。**「src/pages/Home.tsx を変更して」のような技術的な指示は不適切。

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
│   ├── log-reader-mcp/    ログ横断読み取り MCP サーバー
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

### ローカル開発

- Agent Server: `logs/agent-server.log` に JSON Lines で追記 (共通フィールド: `ts`, `level`, `service`, `msg`)。同内容を stdout にも出力
- OpenCode / Vite / Hono: `npm run dev` (npm-run-all) のターミナル集約出力のみ（ファイルには書かれない）

### 本番 (Fly.io)

- `container/start.sh` で 4 プロセスすべての stdout/stderr を `/app/logs/*.log` と Fly stdout の両方に流している (`tee -a`)
- `flyctl logs -a ai-web-builder` で 4 プロセスが **混在** で流れる
  - agent-server 行は JSON Lines (`service` フィールドで識別可能)
  - opencode / vite / hono 行はプレーンテキスト（プレフィックスは付与していない）
- ログファイルを直接見たい場合:

    ```bash
    flyctl ssh console -a ai-web-builder
    tail -f /app/logs/*.log
    ```

- `/app/logs/` は Machine 再起動 / autostop 起動で **消える**（root FS は ephemeral）。過去ログが必要な場合は `flyctl logs` から検索する

### TODO (今回は非対応)

- `/app/logs` を Fly Volume にマウントして永続化する
- `logrotate` で肥大化を防ぐ
- opencode / vite / hono の出力を JSON Lines に揃え、`service` フィールドでフィルタ可能にする
- プロセス名プレフィックスの付与 (`[opencode]` 等) で `flyctl logs` を読みやすくする

## AI フィードバックループ (必須)

OpenCode は編集後に MCP サーバー経由で視覚検証 + ログ確認を行う:
1. 静的解析 (LSP / Lint)
2. Playwright MCP: スクリーンショット取得 → LLM が視覚確認
3. Playwright MCP: ブラウザコンソール → JS エラー検知
4. log-reader MCP: 全プロセスログ横断検索 → ランタイムエラー検知

OpenCode MCP 構成 (opencode.json):
- `playwright`: headless Chromium で localhost:5173 を監視
- `log-reader`: logs/ ディレクトリの全ログを横断読み取り (read_log / search_log / list_logs)

## シークレット

`.envrc` に格納 (gitignore 済み)。本番は Fly Secrets。

- `OPENROUTER_API_KEY` — LLM API
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — デプロイ
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` — GitHub App

## テスト方針 (必須)

AI エージェントがコードを生成・変更するプロジェクトでは、テストはフィードバックループの一部として必須。「動くはず」ではなく「テストが通った」を信頼の基準とする。

### テストフレームワーク

- **vitest** — 単体テスト + 統合テスト
- テストファイルは対象ファイルと同じディレクトリに `*.test.ts` で配置

### テスト対象と方針

| レイヤー | 対象 | 方針 |
|---------|------|------|
| 純粋関数 | detectCommand, buildPrompt, truncateForCommit, extractText 等 | 入出力のマッピングを網羅 |
| Git 操作 | autoCommit, getHistory, revertToCommit 等 | テンポラリ git repo で実物テスト |
| HTTP API | /api/upload, /health 等 | Hono の testClient でリクエスト/レスポンス検証 |
| WS ハンドラー | chat, undo, deploy, history 等 | OpenCode をモックし、メッセージ送受信を検証 |
| MCP サーバー | log-reader の read_log, search_log, list_logs | テンポラリログファイルで実物テスト |

### 実行

```bash
npm test          # 全テスト実行
npm run test:ci   # CI 用（カバレッジ付き）
```

### ルール

- 新機能・バグ修正には対応するテストを書く
- テストが通らない状態でコミットしない
- 外部サービス (OpenCode, GitHub API, Cloudflare) はモックする
- ファイルシステム・Git 操作はテンポラリディレクトリで実物テスト

## セキュリティガイドライン (必須)

### シークレット管理

- ソースコードにシークレットをハードコードしない。必ず `process.env` 経由で参照
- 必須シークレットはアプリ起動時にバリデーション (`if (!key) throw new Error(...)`)
- `.envrc` が `.gitignore` に含まれていることを確認

### 入力バリデーション

- Hono ルートではリクエストボディを Zod スキーマで検証
- WebSocket メッセージは受信時にスキーマ検証してから処理
- D1 クエリは必ずプリペアドステートメント (文字列結合によるSQL構築は禁止)

### フロントエンドセキュリティ

- React の自動エスケープを活用し、unsafe な HTML 注入は使用しない
- ユーザー指定の URL への fetch はドメインホワイトリストで制限
- CORS は許可オリジンを明示指定

### ログ出力

- シークレット (APIキー、トークン) をログに出力しない
- エラーレスポンスにスタックトレースや内部情報を含めない

### 依存パッケージ

- `npm audit --audit-level=high` で HIGH 以上の脆弱性がないことを確認
- 新しい依存パッケージ追加時はセキュリティ影響を確認

## 設計方針

- 過剰設計しない (友人向け個人ツール)
- アンチ・ロックイン (実コード出力、GitHub にバックアップ)
- テンプレート不要 (初回は AI がゼロから生成)

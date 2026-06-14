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
- **本番ホスティング:** Cloudflare (Pages + Workers + D1) または Firebase (Hosting + Cloud Functions)
  - ゲストサイトの workspace 直下に `wrangler.toml` があれば Cloudflare、`firebase.json` があれば Firebase に自動振り分け
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
direnv allow    # .envrc のサーバー側鍵 (GitHub App 等) を読み込み
npm run dev     # 4プロセス並列起動
```

初回起動後、editor の歯車アイコンから設定画面を開いて OpenRouter / Cloudflare / Firebase / Gemini のキーを登録する（BYOK）。OpenRouter キー未登録の状態ではチャット入力が disabled になり、SettingsDialog が自動で開く。

## ログ

### ローカル開発

- Agent Server: `logs/agent-server.log` に JSON Lines で追記 (共通フィールド: `ts`, `level`, `service`, `msg`)。同内容を stdout にも出力
- OpenCode / Vite / Hono: `npm run dev` (npm-run-all) のターミナル集約出力のみ（ファイルには書かれない）

### 本番 (Fly.io)

- 4 プロセスすべての出力が `/app/logs/<service>.log` と Fly stdout の両方に流れる。**全プロセス JSON Lines** (`ts`, `level`, `service`, `msg`) に統一済み:
  - agent-server: `logger.ts` の `appendFileSync` がファイルへ直接 JSON Lines を書く。`start.sh` では **tee を噛ませない**（二重書き＋opencode 出力の混入を防ぐため。stdout はそのまま Fly へ）
  - vite / hono: `start.sh` で `node /app/container/jsonl-wrap.mjs <service>` にパイプして JSON Lines 化してから tee
  - opencode: `opencode-supervisor.ts` が child の stdout/stderr を 1 行ずつ JSON Lines に整形して `opencode.log` と Fly stdout へ流す
- これにより log-reader MCP の `read_log(service, level)` が **全サービスでサービス別 × レベル別**に引ける（AI が必要なセクションをオンデマンドで取得できる）
- `flyctl logs -a ai-web-builder` では 4 プロセスが **混在**で流れる（全行 JSON、`service` フィールドで識別）
- ログファイルを直接見たい場合:

    ```bash
    flyctl ssh console -a ai-web-builder
    tail -f /app/logs/*.log
    ```

- `/app/logs/` は Machine 再起動 / autostop 起動で **消える**（root FS は ephemeral）。過去ログが必要な場合は `flyctl logs` から検索する

### opencode の動作を追う（本番デバッグ）

「opencode が実際に何をしたか（どのツールを呼び、編集が成功したか）」を調べる手順。`/app/logs/opencode.log` は **起動バナーと警告しか出ない**（ツール呼び出しは記録されない）ので注意。本体は HTTP API と SQLite にある。

| 参照先 | 何が分かるか |
|---|---|
| `/app/logs/agent-server.log` (JSON Lines) | セッションのライフサイクル: `OpenCode session created` / `promptAsync sent` / `OpenCode response completed` / `Auto-committed`(hash+message) / `Auto-pushed`。「いつ応答が返り何をコミットしたか」 |
| `/app/logs/chat-handler.log` | プロンプト送信と inactivity タイムアウトの制御ログ |
| **log-reader MCP `list_opencode_sessions` / `read_opencode_session`** | **AI 向けの session 軸取得口**。下記 API を MCP からノイズなく引ける（推奨） |
| **opencode HTTP API `:4096`** | ツール実行トレースの本体（人手 / curl での確認用）。下記参照 |
| `/home/app/.local/share/opencode/opencode.db` (+`-wal`) | opencode の全セッション/メッセージの永続ストア (SQLite)。`log/` サブディレクトリも |

opencode のツール呼び出しと結果（最重要）の取得には2経路ある:

**(a) log-reader MCP（AI がオンデマンドで引く・推奨）** — `:4096` を内部で叩いて要約を返す。curl の生 JSON や DEBUG ノイズに悩まされない:
- `list_opencode_sessions` → `id\ttitle` 一覧
- `read_opencode_session({ sessionId, tail })` → 各ツールの `[status] tool 入力 → 出力 / ERROR` を末尾 N 件

**(b) コンテナ内から API を直叩き（人手デバッグ）:**

```bash
flyctl ssh console -a ai-web-builder
# セッション一覧 (id / title)
curl -s http://localhost:4096/session | jq '.[] | {id, title}'
# 特定セッションの全メッセージ = read/edit/bash 等のツール呼び出し + 結果 (status, output, diff)
curl -s http://localhost:4096/session/<session-id>/message | jq .
```

`message` のレスポンスに各ツールの `state.status`(`completed`/`error`)、`output`(例: `Edit applied successfully.`)、`input`(編集の oldString/newString)、`diff` が入る。「編集が成功したのにファイルが変わっていない／白画面が治らない」系は、ここで edit が `completed` かを確認 → vite ログ (`/app/logs/vite.log`) で HMR 更新が走ったかを照合する。

注意: autostop で Machine が寝ると ssh / curl が空振りする。直前に `curl -s -m 60 https://ai-web-builder.fly.dev/health`(200 を確認) で起こしてから ssh すること。

### TODO (今回は非対応)

- `/app/logs` を Fly Volume にマウントして永続化する
- `logrotate` で肥大化を防ぐ

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

ユーザーが扱う鍵は **BYOK (Bring Your Own Keys)** に統一済み。editor の歯車アイコンから設定画面を開いて登録する。サーバー側の運用鍵 (GitHub App) のみ env / Fly Secrets / `.envrc` で読む。

### BYOK 対象（editor 設定画面から登録）

| プロバイダ | 用途 | 必要フィールド |
|---|---|---|
| OpenRouter | LLM API（OpenCode 経由）— **必須**。未登録時はチャット入力が disabled になる | `apiKey` |
| Gemini | 画像生成（任意） | `apiKey` |
| Cloudflare | wrangler デプロイ（Pages/Workers/D1） | `apiToken` + `accountId` |
| Firebase | firebase-tools デプロイ（Hosting/Functions） | `token` (`firebase login:ci` で発行) |

- 保存先: `/data/secrets.json` (0600)。`SECRETS_FILE` env で上書き可。ローカルでは `<repo>/data/secrets.json` にフォールバック (`container/secrets-reader.mjs::resolveSecretsPath`)
- HTTP API: `GET/PUT/DELETE /api/secrets` (`container/agent-server/src/api-secrets.ts`)。レスポンスに鍵本体を含めず、status は `set` boolean と `last4` のみを返す
- OpenCode 起動: `opencode-supervisor` が secrets.json から openrouter / gemini を読んで `opencode.json` に流し込む。`buildSanitizedEnv()` で `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` を `process.env` から削除した上で spawn する（env 経由の漏洩防止）
- Deploy: `deploy.ts` は `loadSecrets()` 経由で wrangler / firebase に env を渡す。未登録時は `cloudflare_secrets_not_configured` / `firebase_secrets_not_configured` でガード
- 鍵を更新／削除すると openrouter / gemini については opencode が自動再起動 (`opencode-supervisor::restartOpencode`)

### サーバー側鍵（env / Fly Secrets / `.envrc`）

- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` — GitHub App。Installation Token で git push / gh issue
- `GITHUB_OWNER` — 未設定時は `hummer98` にフォールバック（本番では明示設定推奨）

### 旧 Fly Secrets（廃止予定 — 参照されていない）

過去に `flyctl secrets set` で投入された以下のキーは **agent-server のコード上、いずれの経路からも参照されない**。`buildSanitizedEnv()` で明示削除されるので opencode/wrangler/firebase の spawn にも漏れない。Fly 側の値は運用影響を最小化するため削除しないが、将来的には `flyctl secrets unset` で取り除く予定。

- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `FIREBASE_TOKEN`

### 本番認証 (Fly.io)

`NODE_ENV=production` で起動するときの agent-server 認証ポリシー:

- `DEMO_PASSWORD` 設定時 → Basic 認証フォールバックで通過
- `CLOUDFLARE_ACCESS_AUD` + `CLOUDFLARE_ACCESS_TEAM_DOMAIN` 設定時 → Cloudflare Access JWT を `jose` で署名検証 (Cf-Access-Jwt-Assertion ヘッダー or `CF_Authorization` Cookie)
- どちらも未設定 → デモモード警告のみで通過 (Fly 直公開時の互換用)
- `/ws` upgrade は `ALLOWED_ORIGINS` (カンマ区切り) でホワイトリスト化。設定済みなら `Origin` 欠落も 403
- `GITHUB_OWNER` 未設定時は `hummer98` にフォールバック (本番では明示設定推奨)

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

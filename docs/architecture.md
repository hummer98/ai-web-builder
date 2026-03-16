# AI駆動 WYSIWYG Webサイト構築ツール アーキテクチャ構想

## 1. プロジェクト概要

非エンジニアが、稼働中のWebサイトをプレビューしながら、直感的なマウスクリックと自然言語（チャット）の指示だけでサイトをカスタマイズ・構築できるツール。

独自のJSONスキーマ等による「ロックイン」を避け、裏側では標準的なフロントエンド技術（React + Hono）のソースコードを出力・管理する「アンチ・ロックイン」な構成とする。

- **ターゲット:** 友人（非エンジニア）向けの個人ツール（商用サービス展開は想定しない）
- **コアバリュー:** 直感的なWYSIWYG操作、画面が壊れない安全性、実コード出力による高い拡張性
- **インフラ方針:** Fly.io（編集環境） + Cloudflare（本番公開）の2本柱

---

## 2. システムアーキテクチャ全体像

```
┌─────────────────────────────────────────────────────────────────┐
│  ユーザーのブラウザ（シンクライアント）                              │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │  チャットUI   │    │  Iframe プレビュー                     │   │
│  │  (React)     │    │  (Vite HMR WebSocket で即時反映)      │   │
│  └──────┬───────┘    └──────────────────┬───────────────────┘   │
│         │                               │                       │
└─────────┼───────────────────────────────┼───────────────────────┘
          │ WebSocket / REST              │ WebSocket (HMR)
          ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Fly.io コンテナ — 編集環境（Auto Start/Stop）                     │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Agent Server │  │ opencode     │                             │
│  │ :8080        │→ │ serve :4096  │                             │
│  │ (WS橋渡し)   │  │ (AI編集全般)  │                             │
│  └──────────────┘  └──────────────┘                             │
│  ┌──────────┐  ┌──────────┐                                    │
│  │  Vite    │  │  Hono    │                                    │
│  │  :5173   │  │  :3000   │                                    │
│  └──────────┘  └──────────┘                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Fly Volume (NVMe)                                       │   │
│  │  workspace/ (src/ + functions/) / .git                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │ wrangler deploy
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare — 本番環境（常時稼働）                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Pages       │  │  Workers     │  │  D1                  │  │
│  │  (React      │  │  (Hono       │  │  (SQLite互換DB)      │  │
│  │   静的ファイル)│  │   API)       │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React + Tailwind CSS |
| バックエンド | Hono（開発: Node.js / 本番: Cloudflare Workers） |
| データベース | Cloudflare D1（SQLite互換、編集時もHTTP経由で共有） |
| AI Agent | OpenCode（サーバーモード `opencode serve :4096`） |
| AI モデル | OpenRouter 経由（Gemini 3.1 Pro / GPT-5.2-Codex / Kimi K2.5 等を切り替え可能） |
| 編集環境 | Fly.io（Fly Machines + Fly Volumes） |
| 本番ホスティング | Cloudflare Pages + Workers |
| GitHub 連携 | GitHub App（`ai-web-builder[bot]`）によるコミット・issue操作 |
| 認証 | 固定トークン or Basic認証（友人向け） |
| シークレット管理 | Fly Secrets（環境変数として注入） |

### 2.2 エディターモードと本番の対応

同じコードが両環境で動く構成。

| 役割 | エディターモード (Fly.io) | 本番 (Cloudflare) |
|------|--------------------------|-------------------|
| フロントエンド | Vite Dev Server :5173 | Pages（静的ファイル） |
| バックエンド API | Hono Dev Server :3000 | Workers |
| データベース | D1（HTTP経由） | D1（ネイティブ） |
| 即時反映 | Vite HMR + tsx watch | — |

---

## 3. リポジトリ構成

本プロジェクトは **2つのリポジトリ** で構成される。

```
┌────────────────────────────────────────────────────────────┐
│ リポジトリ①: ai-web-builder（ビルダーツール本体）              │
│                                                            │
│  editor/          エディターUI（チャット + Iframe シェル）    │
│  container/       コンテナ内ランタイム                       │
│  │  agent-server/   WebSocket受付 → opencode serve 橋渡し   │
│  │  scaffold/       ゲストサイトの初期ファイル一式             │
│  Dockerfile       コンテナイメージ定義                       │
│  fly.toml         Fly.io 設定                               │
│                                                            │
│  ※ ゲストリポジトリの自動コミット・push もここから制御する     │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ リポジトリ②: ゲストリポジトリ（友人ごとに1つ）                │
│                                                            │
│  src/             React フロントエンド                       │
│  functions/       Hono バックエンド API                      │
│  package.json     依存定義                                  │
│  wrangler.toml    Cloudflare デプロイ設定                    │
│                                                            │
│  ※ AIが編集する対象。Fly Volume上に配置。                    │
│  ※ GitHub にも push してコードをバックアップ。               │
└────────────────────────────────────────────────────────────┘
```

### 3.1 GitHub App（ai-web-builder[bot]）

ゲストリポジトリの操作は個人アカウント（hummer98）ではなく、専用の **GitHub App** が行う。
コミットやissue作成が `ai-web-builder[bot]` 名義になり、個人の操作と区別できる。

```
GitHub App: ai-web-builder
├── App ID + 秘密鍵 (PEM) → Fly Secrets に格納
├── 権限: Contents(R/W), Issues(R/W), Metadata(R)
└── インストール先: ゲストリポジトリを選択式で追加

hummer98/cafe-site         ← App インストール済み
hummer98/photo-studio      ← App インストール済み
```

**トークンの取得フロー（コンテナ起動時に自動実行）:**

```
秘密鍵 (PEM) → JWT 生成 → GitHub API → Installation Token 取得
    ↓
短期トークン（1時間有効、自動更新）
    ↓
git push / gh issue create → "ai-web-builder[bot]" 名義
```

### 3.2 ゲストリポジトリの自動管理

ゲストリポジトリのGit・issue操作は ai-web-builder の Agent Server が自動で行う。友人はGitを意識しない。

| タイミング | 自動実行される操作 |
|-----------|-------------------|
| AIの編集が反映された時 | `git add -A && git commit -m "変更内容の要約"` |
| 一定間隔 or 本番公開時 | `git push origin main` |
| Undo操作時 | `git revert HEAD` |
| AIの作業ログ | `gh issue create` で変更履歴を記録 |

- コミット・issue作成は `ai-web-builder[bot]` 名義で実行
- コミットメッセージはAIが変更内容を要約して自動生成
- push 先は GitHub のプライベートリポジトリ（バックアップ目的）
- 友人がコードを持ち出したい場合、GitHub からそのままcloneできる（アンチ・ロックイン）

---

## 4. コア機能と実現メカニズム

### 4.1 マウスによる要素指定（Source Locator）

SWC/Babelプラグインにより、全JSX要素にユニークID（`data-oc-id`）を自動注入する。ユーザーがIframe内で要素をクリックすると、ファイル・行・コンポーネント情報が特定され、周辺コンテキストと共にLLMへ渡される。

```
ユーザーのクリック
    ↓
<h1 data-oc-id="Hero_tsx:h1:3:4" data-oc-component="Hero">
    ↓
コンテキスト収集（要素情報 + コンポーネント階層 + ソースコード）
    ↓
LLM に送信
```

- Iframe内でのホバー時にハイライトオーバーレイを表示（DevToolsライクなUX）
- ドラッグによる範囲選択で複数要素を指定可能
- postMessage でIframe → エディター間を通信

### 4.2 レイアウトガイドオーバーレイ

非エンジニアが「ヘッダー」「フッター」等のセマンティックな領域を視覚的に把握できるよう、Iframe 内にガイドオーバーレイを表示する。Vite プラグインで開発時のみ自動注入し、ゲストサイトのコードには一切触れない（ビルド成果物にも含まれない）。

**注入方式:**

```
Vite Dev Server
├── HMR クライアント注入（Vite 標準）
└── /__editor__/overlay.js 注入（カスタム Vite プラグイン）
    └── HTML5 セマンティック要素を検出 → 日本語ラベル表示
```

**セマンティック要素 → 日本語ラベル対応:**

| HTML 要素 | 表示ラベル | 色 |
|-----------|----------|-----|
| `<header>` | ヘッダー | 青 |
| `<nav>` | メニュー | 緑 |
| `<main>` | メインコンテンツ | 紫 |
| `<section>` | コンポーネント名（`data-oc-component` から取得） | グレー |
| `<article>` | 記事 | オレンジ |
| `<aside>` | サイドバー | 黄 |
| `<footer>` | フッター | 青 |
| `<form>` | フォーム | 赤 |

**表示モード:**

| モード | 表示 | 切り替え |
|--------|------|---------|
| 通常モード | ラベル非表示 | デフォルト |
| インスペクトモード | ラベル + 枠線 + ホバーハイライト | エディターのトグルボタン |

※ 仕様は暫定。実際の使用感を見ながらラベル粒度や表示タイミングを調整する。

### 4.3 自己修復ループ + AI視覚フィードバック（In-Container Staging）

AI が生成したコードで画面が壊れるのを防ぐ仕組み。Lint だけでなく、**Playwright で実際の画面を確認し、ログを読んで自己検証する**のがポイント。

```
1. LLMがシャドウファイル（複製）またはGit worktreeに変更を加える
       ↓
2. バックグラウンドで Lint / AST解析を実行
       ↓
   ┌── Lintエラー → LLMに自動リトライ（ユーザーには見せない）
   │
   └── Lint通過 ↓
3. メインファイルにマージ → HMR / tsx watch で反映
       ↓
4. 【視覚検証】Playwright でページをキャプチャ
   ├── スクリーンショット取得 → LLMが視覚的に確認
   ├── ブラウザコンソールログ読み取り → JSエラー検知
   └── ネットワークリクエスト確認 → API疎通チェック
       ↓
   ┌── 問題あり → LLMが原因を分析して自動修正
   │
   └── 問題なし → ユーザーに反映完了を通知
```

**3段階のフィードバック:**

| 段階 | 手段 | 検知できること |
|------|------|--------------|
| ① 静的解析 | LSP / Lint / AST | 構文エラー、型エラー、未使用import |
| ② 視覚検証 | Playwright スクリーンショット | レイアウト崩れ、白画面、表示崩れ |
| ③ ランタイム検証 | Playwright コンソール + ログファイル | JSランタイムエラー、API 500、HMR失敗 |

### 4.4 Playwright / Chrome MCP によるAI視覚フィードバック（必須）

AIが「目」を持つための仕組み。OpenCode の MCP サーバーとして Playwright を接続し、編集後に自動で画面とログを検証する。

```
opencode serve
    │
    ├── MCP: Playwright
    │   ├── screenshot()         → 画面キャプチャをLLMに渡す
    │   ├── console_messages()   → ブラウザコンソールのエラーを取得
    │   ├── network_requests()   → API呼び出しの成否を確認
    │   └── evaluate()           → DOM状態を直接検査
    │
    └── MCP: ログリーダー（カスタム）
        ├── read_log(service, level, tail)
        │   → agent-server.log / vite.log / hono.log を横断読み取り
        └── search_log(pattern)
            → 全ログからパターン検索
```

**コンテナ内の Playwright 構成:**

```
Fly.io コンテナ
├── opencode serve :4096
│   └── MCP servers:
│       ├── playwright (headless Chromium)
│       │   → http://localhost:5173 を監視
│       └── log-reader (カスタムMCP)
│           → logs/ ディレクトリを読み取り
├── Vite :5173  ← Playwright がここにアクセス
├── Hono :3000
└── Agent Server :8080
```

**AIの自己検証フロー例:**

```
ユーザー: 「ヘッダーを青くして」
    ↓
AI: Hero.tsx のスタイルを編集
    ↓
Lint 通過 → HMR 反映
    ↓
AI: Playwright でスクリーンショット取得
AI: 「ヘッダーが青くなっていることを確認。コンソールエラーなし。」
    ↓
AI: hono.log を確認 → API正常
    ↓
ユーザーに完了通知
```

- ユーザーには常に「動く画面」だけが見える
- `opencode serve` の LSP 統合 + Git スナップショットを活用
- 最大リトライ回数を超過した場合はユーザーに通知
- `opencode web` でAIの思考過程・編集履歴をブラウザで確認可能（デバッグ用）

### 4.5 爆速リアルタイム反映

| 変更対象 | 反映方式 | 反映速度 |
|---------|---------|---------|
| フロントエンド (src/) | Vite HMR | ミリ秒 |
| バックエンド (functions/) | tsx watch → 自動再起動 | 約1秒 |
| CSS (Tailwind) | Vite HMR（リロードなし） | ミリ秒 |

---

## 5. インフラとデータ管理

### 5.1 Fly.io（編集環境）

| リソース | 仕様 | 用途 |
|---------|------|------|
| Fly Machine | 1 vCPU / 1GB RAM | 編集用コンテナ |
| Fly Volume | NVMe ベース | ワークスペース / .git の永続化 |
| Fly Secrets | 暗号化された環境変数 | APIキー等のシークレット管理 |

**Auto Start/Stop** により、使っていない時間は課金されない。

**コンテナ内プロセス構成:**

| プロセス | ポート | 役割 |
|---------|-------|------|
| Agent Server | :8080 | ブラウザからのWebSocket受付、OpenCodeへの橋渡し |
| `opencode serve` | :4096 | AI編集エンジン（ファイル編集・LSP・Git管理） |
| Vite Dev Server | :5173 | フロントエンド（HMR対応） |
| Hono Dev Server | :3000 | バックエンドAPI（tsx watch で自動再起動） |

```
Browser ─── WS ───→ Agent Server :8080 ─── HTTP/SSE ───→ opencode serve :4096
                          │                                    │
                          │ イベント転送                        │ ファイル編集
                          ↓                                    ↓
                     ブラウザに通知                         Fly Volume
                                                          ├── src/      → Vite HMR 発火
                                                          └── functions/ → tsx watch 再起動
```

### 5.2 Cloudflare（本番環境）

| サービス | 無料枠 | 用途 |
|---------|--------|------|
| Pages | 帯域無制限 | React ビルド済み静的ファイル |
| Workers | 10万リクエスト/日 | Hono バックエンド API |
| D1 | 5GB / 500万reads/日 | SQLite互換データベース |
| R2 | 10GB | 画像等のファイルストレージ（必要時） |

### 5.3 シークレット管理

全シークレットは Fly Secrets に格納し、コンテナ内で環境変数として参照する。

**必須:**

| 変数名 | 用途 | 取得先 |
|--------|------|--------|
| `OPENROUTER_API_KEY` | LLM API（OpenCode経由） | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `CLOUDFLARE_API_TOKEN` | wrangler デプロイ（Pages/Workers/D1） | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント識別 | Cloudflare ダッシュボード サイドバー |
| `GITHUB_APP_ID` | GitHub App 識別 | App 作成時に発行 |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App 認証用秘密鍵（PEM） | App 作成時にダウンロード |

**GitHub App トークン取得フロー（コンテナ起動時）:**

```
GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY
    → JWT 生成 → Installation Token API
    → 短期トークン（1時間有効、自動更新）
    → git push / gh issue create
```

**Fly Secrets への設定（1回だけ）:**

```bash
fly secrets set \
  OPENROUTER_API_KEY="sk-or-v1-..." \
  CLOUDFLARE_API_TOKEN="..." \
  CLOUDFLARE_ACCOUNT_ID="..." \
  GITHUB_APP_ID="123456" \
  GITHUB_APP_PRIVATE_KEY="$(cat github-app.pem)" \
  -a ai-web-builder
```

### 5.4 本番公開フロー

```bash
# 「本番公開」ボタン押下時にコンテナ内で実行
npm run build
npx wrangler pages deploy dist --project-name=site-name
npx wrangler deploy functions/api/index.ts
```

---

## 6. ユーザーの操作フロー

```
① アクセス ──→ ② 要素指定 ──→ ③ チャット指示 ──→ ④ 即時反映 ──→ ⑤ 本番公開
```

| # | ユーザーの操作 | 裏側の処理 |
|---|--------------|-----------|
| ① | 管理画面を開く | Fly Machine 自動起動、Vite + Hono サーバー起動 |
| ② | プレビュー画面の要素をクリック | Source Locator がコンポーネント・ソース位置を特定 |
| ③ | チャットで「ここを青くして」と送信 | AI がシャドウファイルを編集 → Lint → 自己修復ループ |
| ④ | 画面が即座に更新される | HMR (フロント) / tsx watch (バックエンド) で反映 |
| ⑤ | 「本番公開」ボタンを押す | wrangler deploy → Cloudflare Pages + Workers にデプロイ |
| ⑥ | ブラウザを閉じる | Fly Machine 自動停止、課金停止 |

---

## 7. ゲストサイトの初期化

新規作成と既存リポジトリの取り込み、どちらにも対応する。

### 7.1 パターン A: 新規作成（ゼロから生成）

```
ユーザー: 「カフェのサイトを作って」
    ↓
Agent Server:
  1. gh repo create hummer98/cafe-site --private
  2. GitHub App を対象リポジトリにインストール
  3. scaffold を Fly Volume にコピー + git init
  4. git push origin main
    ↓
AI が src/ (フロント) + functions/ (API) を生成
    ↓
Vite + Hono 起動 → プレビュー表示
```

テンプレートは用意せず、AIがゼロから生成する。

### 7.2 パターン B: 既存リポジトリの取り込み

```
ユーザー: 「hummer98/photo-studio を編集したい」
    ↓
Agent Server:
  1. GitHub App が対象リポジトリにインストール済みか確認
  2. git clone → Fly Volume に配置
  3. npm install（scaffold にないパッケージがあれば追加）
    ↓
Vite + Hono 起動 → プレビュー表示
    ↓
以降はクリック + チャットで編集
```

既存リポジトリの場合、AIがまずコードベースを読み取って構造を理解してから編集に入る。

### 7.3 コンテナイメージに事前焼き込み（スキャフォールド）

新規作成時にコピーされる初期ファイル一式。`node_modules` を焼き込むことで初回の `npm install` 待ちを回避する。

```
container/scaffold/
├── package.json          (React + Tailwind + Hono + 必要な依存)
├── node_modules/         (インストール済み)
├── vite.config.ts        (proxy: /api → localhost:3000)
├── tailwind.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx          (エントリーポイント)
│   └── App.tsx           (最小限)
└── functions/
    └── api/
        └── index.ts      (Hono 最小構成)
```

### 7.4 画像・アセットの管理

画像等のアセットは **Cloudflare R2** に保存する。Git リポジトリの肥大化を防ぎ、開発時と本番で同じ URL を使える。

**アップロード経路:**

| 方法 | 操作 |
|------|------|
| チャットにドラッグ&ドロップ | 画像を貼り付けて「これをヒーローに使って」 |
| アップロードボタン | エディター UI のファイルピッカーから選択 |
| URL 指定 | チャットで「この画像を使って: https://...」 |

**フロー:**

```
ユーザー: 画像をドラッグ&ドロップ + 「ヒーローセクションに配置して」
    ↓
Agent Server:
  1. R2 にアップロード
     → https://assets.example.com/cafe-site/hero.jpg
  2. OpenCode に指示
     → 「Hero.tsx に img タグを追加」
    ↓
AI がコード編集 → HMR で即反映
```

- R2 バケットはゲストサイトごとにプレフィックスで分離（`cafe-site/`, `photo-studio/`）
- 開発時は Vite proxy、本番は Workers から同じ URL で配信
- 画像の URL はコード内にハードコードされるため、Git に含まれるのは URL 文字列のみ

---

## 8. ローカル開発環境

コンテナなしでローカルPCで全プロセスを起動して開発・動作確認できる。

### 8.1 前提条件

- Node.js (v22+)
- OpenCode CLI (`npm i -g opencode`)
- direnv（`.envrc` の自動読み込み）

### 8.2 起動

```bash
cd ai-web-builder
direnv allow  # .envrc のシークレットを読み込み

# 4プロセスを起動（npm-run-all 等で並列実行）
npm run dev
# 内部的に:
#   Agent Server     → node container/agent-server/index.ts   :8080
#   opencode serve   → opencode serve                         :4096
#   Vite Dev Server  → npm run dev --prefix workspace         :5173
#   Hono Dev Server  → tsx watch workspace/functions/api/index.ts :3000
```

### 8.3 ローカルと本番の差異

| 項目 | ローカル | Fly.io コンテナ |
|------|---------|----------------|
| プロセス管理 | npm-run-all 等 | Dockerfile ENTRYPOINT |
| ワークスペース | `./workspace/` | Fly Volume `/data/workspace/` |
| Auto Start/Stop | なし | Fly Proxy 経由 |
| シークレット | `.envrc` | Fly Secrets |
| それ以外 | **全て同一** | **全て同一** |

---

## 9. ログ設計

全プロセスのログをAI（Claude Code / OpenCode）が確認・分析できるように、構造化ログを統一フォーマットでファイル出力する。

### 9.1 ログ出力先

```
logs/
├── agent-server.log       Agent Server（WS接続、OpenCode連携）
├── opencode.log           opencode serve（AI編集、LSP診断、Gitスナップショット）
├── vite.log               Vite Dev Server（HMR、ビルドエラー）
├── hono.log               Hono Dev Server（API リクエスト、ランタイムエラー）
└── deploy.log             本番デプロイ（wrangler 出力）
```

### 9.2 ログフォーマット（JSON Lines）

```json
{"ts":"2026-03-16T10:23:45.123Z","level":"info","service":"agent-server","msg":"WS connected","clientId":"abc123"}
{"ts":"2026-03-16T10:23:46.456Z","level":"info","service":"opencode","msg":"file edited","file":"src/components/Hero.tsx","lines":"3-8"}
{"ts":"2026-03-16T10:23:46.500Z","level":"error","service":"opencode","msg":"lint failed","file":"src/components/Hero.tsx","errors":["..."]}
{"ts":"2026-03-16T10:23:47.100Z","level":"info","service":"vite","msg":"hmr update","file":"src/components/Hero.tsx","duration":"12ms"}
```

- **JSON Lines** — 1行1イベント。grep/jq で簡単にフィルタ可能
- **共通フィールド:** `ts`（ISO8601）、`level`、`service`、`msg`
- **stdout にも同時出力** — ローカル開発時はターミナルでも確認可能

### 9.3 AIからのログ確認

Claude Code のスキル `/logs` でログを横断的に調査できる。

```
ユーザー: /logs エラーが出ている
    ↓
Claude Code が logs/ 配下を読み取り
    ↓
全プロセスのエラーを横断分析して原因を特定
```

| 調査シナリオ | 対象ログ |
|-------------|---------|
| 画面が更新されない | vite.log（HMR失敗？）→ opencode.log（編集失敗？） |
| APIが500を返す | hono.log（ランタイムエラー）→ opencode.log（コード編集ミス？） |
| AIが応答しない | agent-server.log（WS切断？）→ opencode.log（LLMタイムアウト？） |
| デプロイ失敗 | deploy.log（wrangler エラー） |

---

## 10. 今後の検討事項

- [ ] エディターUI ↔ Fly.ioコンテナ間の WebSocket 通信プロトコル詳細設計
- [ ] AI Agent (OpenCode) のプロンプト設計とコンテキスト管理戦略
- [ ] Source Locator の SWC プラグイン実装
- [ ] 自己修復ループの最大リトライ回数・タイムアウト設定
- [ ] Cloudflare D1 のスキーマ管理（マイグレーション）
- [ ] マルチページ対応時のルーティング管理
- [ ] バージョン管理（Git）の UI 設計（Undo/Redo）

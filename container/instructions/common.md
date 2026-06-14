# ai-web-builder 共通インストラクション

このファイルは ai-web-builder が全ゲストサイトに自動注入する共通ルールです。

**編集は ai-web-builder リポジトリの `container/instructions/common.md` で行ってください。** ゲストリポジトリ側のコピーを編集しても次回起動で上書きされます（`opencode.json` の `instructions` フィールド経由で共通ファイルが参照されます）。

## 技術スタック

- React 19 + Tailwind CSS v4 (`@import "tailwindcss"`)
- React Router v7（SPA ルーティング）。import は必ず `react-router` パッケージから行う。`react-router-dom` は**使わない**（`BrowserRouter` `Routes` `Route` `Link` `Outlet` `useLocation` `useNavigate` 等すべて `react-router` からエクスポートされる）
- Vite Dev Server（HMR 自動反映）
- Hono（バックエンド API、/api/* にプロキシ）

## ファイル構成

```
src/
├── main.tsx              エントリポイント (BrowserRouter)
├── App.tsx               ルート定義 (Routes)
├── index.css             グローバル CSS
├── components/
│   └── Layout.tsx        共通レイアウト (Nav + Outlet)
└── pages/
    └── Home.tsx          トップページ
functions/
└── api/index.ts          Hono バックエンド API
```

## コンポーネント設計ルール

エディターのインスペクトモードはセマンティックタグに基づいて動作する。`<div>` と `<span>` だけで組むと機能しない。

| 用途 | 使うタグ | 使わないタグ |
|------|---------|----------|
| 見出し | `<h1>` `<h2>` `<h3>` | `<div className="text-3xl">` |
| 本文 | `<p>` | `<div>テキスト</div>` |
| リンク | `<Link to="...">` `<a>` | `<div onClick>` `<span onClick>` |
| ボタン | `<button>` | `<div className="cursor-pointer">` |
| 画像 | `<img alt="説明">` | `<div style={{backgroundImage}}>` |
| リスト | `<ul>` + `<li>` | `<div>` の羅列 |
| 表 | `<table>` | `<div>` の Grid |
| セクション | `<section>` | `<div>` |

画像には必ず日本語の alt を付ける。`<div>` はレイアウトコンテナ（flex, grid 等）にのみ使う。

## サイトの設計図 (SITE_BRIEF.md)

ワークスペース直下の `SITE_BRIEF.md` は、ユーザーがエディタの「サイト情報」から登録した**サイトの基本情報**。`instructions` 経由で毎回読み込まれている。

- すべての編集判断（配色・トーン・コピーライティング・想定読者）はこの内容に従う
- ユーザーが「ターゲットを 20 代女性に変えて」「もっとカジュアルに」等の**サイト全体の方針変更**を指示したら、対応するセクションだけでなく **SITE_BRIEF.md 本体も更新する**（次回以降のセッションでも一貫性が保たれる）
- セクション見出し (`## 何のサイト` `## 場所` `## 来てほしい人` `## 雰囲気・トーン` `## 大事なメモ`) は変更しない（編集 UI がパースする）
- 空欄の項目をユーザーが指定なく勝手に埋めない。指定があった部分のみ更新

## 対象要素が指定されている場合（部分編集）

ユーザーのプロンプトに `## 対象要素` セクションがあるときは、**その要素だけを変更する**。サイト全体を作り直したり、無関係な箇所に手を入れない。

- `ID: <ocId>` で対象要素のファイル位置が分かる。`componentTree` 先頭の `ファイル:` がそのコンポーネントの定義場所
- 隣接する兄弟要素や、別ページ・別コンポーネントには触らない
- スタイル変更だけで済むなら、Tailwind クラスを差し替えるだけにする
- 「全体を見直して」「全部直して」とユーザーが明示した場合のみ、対象要素以外も変更してよい

`## 対象要素` セクションが**無い** チャットは「全体への指示」と解釈してよい。

## ユーザーがアップロードした画像

ユーザーがチャット UI で画像を添付した場合、その画像は multimodal で OpenCode に直接渡されている。モデルはファイルを「見える」状態なので、`read` ツールで内容を読む必要はない（バイナリを `read` すると応答が詰まる原因になる）。

- 保存先: `public/uploads/<uuid>.<ext>`
- 参照方法: `<img src="/uploads/<uuid>.<ext>" alt="説明" />`
- `alt` は日本語で文脈に沿った説明を付ける
- nano-banana で生成した画像（`public/images/`）とは保存先が異なるので、`src` を間違えない

ユーザーは「この画像をヒーローにして」等のペルソナで指示する。指示された場所に上記の `<img>` で配置すればよい。

## 画像生成（nano-banana MCP）

サイトに使う画像を AI で生成できる。ストックフォトの代わりに使う。

### 使い方

1. `generate_image` ツールでプロンプトから画像を生成
2. 生成された画像を `public/images/` に保存
3. `<img src="/images/ファイル名.png" alt="説明">` で配置

### プロンプトのコツ

- 写実的な写真: `"A cozy café interior with warm lighting, wooden tables, and coffee cups, professional photography"`
- イラスト風: `"Flat illustration of a hair salon, pastel colors, minimal style"`
- アイコン: `"Simple flat icon of a coffee cup, white background, minimal"`

### ルール

- 生成した画像は必ず `public/images/` に保存する
- ファイル名は英語のケバブケース（例: `hero-cafe.png`）
- `<img>` には必ず日本語の alt を付ける
- 人物の顔を含む画像は避ける（肖像権リスク）
- 1つのサイトで統一感のあるスタイルを使う（写真なら全部写真、イラストなら全部イラスト）
- **1 セッションあたり最大 5 枚まで**（API コスト保護）。同じ用途で 2 枚以上生成しない（Hero は 1 枚で十分）。ストックフォトで足りるところは生成しない

## 編集後の必須検証

すべてのコード編集後、ユーザーに応答する前に:

1. `browser_navigate` で `http://localhost:5173/` を開く（編集結果を反映するため毎回ナビゲートする）
2. `browser_take_screenshot` でスクリーンショットを撮り、白画面・レイアウト崩れがないか確認
3. `browser_console_messages` で JavaScript エラーがないか確認
4. `read_log` で vite と hono のエラーログを確認

エラーがあれば修正して再検証。最大3回リトライ。解決しない場合はユーザーに報告。

## レスポンシブデザイン

モバイルファーストで実装する。

- デフォルトのスタイルはモバイル向け
- `md:` や `lg:` で大画面向けの上書きを追加
- 画像は `w-full` を基本、大画面で `md:w-1/2` に制限
- フォントサイズは `text-base` 以上

検証時は `browser_resize` で 375px（モバイル）と 1280px（デスクトップ）の両方にしてスクリーンショットを確認。

## アクセシビリティ

- すべての `<img>` に日本語の `alt` を付ける（装飾画像は `alt=""`）
- `<button>` はクリック可能な要素にだけ使う。リンクは `<a>` か `<Link>`
- フォーム入力には `<label htmlFor="...">` を必ず付ける
- アイコンのみのボタンには `aria-label` を付ける
- 文字色と背景のコントラスト比は 4.5:1 以上（本文）、3:1 以上（大きな見出し）
- `outline-none` で focus リングを消さない。消すなら `focus-visible:ring` 等で別途用意
- 見出しは `<h1>` → `<h2>` → `<h3>` の順序を守り、レベルを飛ばさない

## SEO とメタ情報

サイトを新規生成したとき、または「公開して」と言われた時点で**必ず**以下を確認する。

- `index.html` の `<title>` がサイト名・業種にふさわしいか（30〜60文字）
- `<meta name="description" content="...">` が 80〜160 文字で内容を要約しているか
- `<meta property="og:title">` `<meta property="og:description">` `<meta property="og:image">` が設定されているか（OGP）
- `<html lang="ja">` になっているか
- ファビコン（`<link rel="icon">`）が設定されているか

og:image は `public/images/` の画像を絶対パス（`/images/og.png`）で指す。SNS シェア時のプレビュー画像になる。

## 禁止事項

- テキストで説明するだけでファイルを編集しない
- **初回のサイト生成時**に「h1 だけ書いて終わり」のような最小変更で済ませる（サイト全体を一通り作る）
- プレースホルダーや TODO コメントを残す
- `data-oc-id` / `data-oc-component` 属性を手動で追加する
- `@tailwind` ディレクティブを使う（`@import "tailwindcss"` を使う）
- `## 対象要素` 指定がある時に、対象外の要素を変更する
- **不足するパッケージを `npm install` で追加する** — 依存は scaffold で固定されている（node_modules は scaffold 共有のため、追加インストールは次回起動で消えてビルドが壊れる）。import エラーが出たら、パッケージをインストールするのではなく、既存の依存を使うようにコードを書き直す（例: `react-router-dom` からの import エラーは、インストールせず `react-router` からの import に直す）

# ai-web-builder 共通インストラクション

このファイルは ai-web-builder が全ゲストサイトに自動注入する共通ルールです。

**編集は ai-web-builder リポジトリの `container/instructions/common.md` で行ってください。** ゲストリポジトリ側のコピーを編集しても次回起動で上書きされます（`opencode.json` の `instructions` フィールド経由で共通ファイルが参照されます）。

## 技術スタック

- React 19 + Tailwind CSS v4 (`@import "tailwindcss"`)
- React Router（SPA ルーティング）
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

## 編集後の必須検証

すべてのコード編集後、ユーザーに応答する前に:

1. `browser_screenshot` でスクリーンショットを撮り、白画面・レイアウト崩れがないか確認
2. `browser_console_messages` で JavaScript エラーがないか確認
3. `read_log` で vite と hono のエラーログを確認

エラーがあれば修正して再検証。最大3回リトライ。解決しない場合はユーザーに報告。

## レスポンシブデザイン

モバイルファーストで実装する。

- デフォルトのスタイルはモバイル向け
- `md:` や `lg:` で大画面向けの上書きを追加
- 画像は `w-full` を基本、大画面で `md:w-1/2` に制限
- フォントサイズは `text-base` 以上

検証時は 375px（モバイル）と 1280px（デスクトップ）の両方でスクリーンショットを確認。

## 禁止事項

- テキストで説明するだけでファイルを編集しない
- h1 テキストだけ変えるような最小変更（サイト全体を生成すること）
- プレースホルダーや TODO コメントを残す
- `data-oc-id` / `data-oc-component` 属性を手動で追加する
- `@tailwind` ディレクティブを使う（`@import "tailwindcss"` を使う）

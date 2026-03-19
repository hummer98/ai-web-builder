# AI Web Builder — ゲストサイト編集ガイド

## 技術スタック

- React 19 + Tailwind CSS v4 (@import "tailwindcss" 方式、@tailwind ディレクティブは使わない)
- React Router (SPA ルーティング)
- Vite Dev Server (HMR 自動反映)
- Hono (バックエンド API, /api/* にプロキシ)

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

## コンポーネント設計ガイドライン（必須）

エディターのインスペクトモードは JSX のセマンティックタグに基づいて日本語ラベルを表示し、コンテキストメニューでテキスト編集・画像差し替え・削除を提供する。**`<div>` と `<span>` だけで組むとこれらの機能が動作しない。**

### コンポーネントの分割

ページは**セクション単位**でコンポーネントに分割する。各コンポーネントはセマンティックタグをルートに持つ:

```tsx
// src/pages/Home.tsx
export default function Home() {
  return (
    <main>
      <HeroSection />
      <MenuSection />
      <AccessSection />
      <ContactSection />
    </main>
  );
}
```

```tsx
// src/components/HeroSection.tsx — セクションコンポーネントの例
export default function HeroSection() {
  return (
    <section className="py-16 text-center">
      <h1 className="text-4xl font-bold">Le Serpent</h1>
      <p className="mt-4 text-lg text-gray-600">フレンチビストロ</p>
      <img src="/uploads/hero.jpg" alt="店舗外観" className="mt-8 w-full md:w-1/2 mx-auto" />
      <Link to="/menu" className="mt-6 inline-block bg-blue-600 text-white px-6 py-3 rounded-lg">
        メニューを見る
      </Link>
    </section>
  );
}
```

### JSX タグの使い分け

| 用途 | 使うタグ | 避けるタグ |
|------|---------|----------|
| ページの見出し | `<h1>` (1ページに1つ) | `<div className="text-3xl">` |
| セクション見出し | `<h2>`, `<h3>` | `<p className="font-bold text-xl">` |
| 本文テキスト | `<p>` | `<div>テキスト</div>` |
| ページ内リンク | `<Link to="...">` | `<div onClick={...}>` |
| 外部リンク | `<a href="..." target="_blank">` | `<span onClick={...}>` |
| アクションボタン | `<button>` | `<div className="cursor-pointer">` |
| 画像 | `<img alt="説明文">` | `<div style={{backgroundImage}}>` |
| リスト | `<ul>` + `<li>` | `<div>` の羅列 |
| 表 | `<table>` + `<thead>` + `<tbody>` | `<div>` の Grid レイアウト |
| フォーム | `<form>` + `<input>` + `<textarea>` | — |
| セクション区切り | `<section>` | `<div>` |
| サイドバー | `<aside>` | `<div>` |
| 記事 | `<article>` | `<div>` |

### 画像には必ず alt を付ける

```tsx
// ✅ — alt がインスペクトモードのツールチップに表示される
<img src="/uploads/shop.jpg" alt="店舗外観" className="w-full rounded-lg" />

// ❌
<img src="/uploads/shop.jpg" />
```

### `<div>` を使ってよい場面

- Tailwind のレイアウトコンテナ（`flex`, `grid`, `max-w-*` 等）
- 装飾的なラッパー（背景色、パディング等）
- 意味的に該当するセマンティックタグがない場合

## 新ページ追加の手順

1. `src/pages/` に新しいページコンポーネントを作成:

```tsx
// src/pages/About.tsx
export default function About() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">About</h1>
    </main>
  );
}
```

2. `src/App.tsx` にルートを追加:

```tsx
import About from "./pages/About";

<Route element={<Layout />}>
  <Route index element={<Home />} />
  <Route path="about" element={<About />} />
</Route>
```

3. ナビゲーションリンクを `src/components/Layout.tsx` に追加:

```tsx
<Link to="/about">About</Link>
```

## 編集後の必須検証（自己修復ループ）

**すべてのコード編集後、ユーザーへの応答前に以下の検証を実行すること。**

### 1. 視覚検証

`browser_screenshot` でページのスクリーンショットを取得し、以下を確認:

- 白画面になっていないか
- レイアウトが崩れていないか
- 変更が意図通り反映されているか

### 2. コンソール確認

`browser_console_messages` でブラウザコンソールを取得し、JavaScript エラーがないか確認。

### 3. ログ確認

`read_log` で vite と hono の error レベルログを確認し、ランタイムエラーがないか確認。

### エラー発見時の対応

1. 原因を特定して修正
2. 上記の検証を再実行
3. 最大 3 回のリトライ後も解決しない場合は、ユーザーに以下を報告:
   - 何が問題か
   - 何を試したか
   - 推奨される次のアクション

## フォーム送信

お問い合わせフォームなどを作成する際は、scaffold に組み込まれた `POST /api/contact` エンドポイントを利用する。

### 基本的な使い方

フォームから `fetch` で JSON を送信:

```tsx
const res = await fetch("/api/contact", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, email, message }),
});
const data = await res.json();
if (data.success) {
  // 送信完了の表示
}
```

- 必須フィールド: `name`, `email`, `message`
- 送信データは `data/submissions.json` に JSON Lines 形式で保存される

### カスタムエンドポイントの追加

予約フォームなど別の用途のエンドポイントを追加するには、`functions/api/index.ts` にルートを追加する:

```ts
app.post("/api/reservation", async (c) => {
  const body = await c.req.json();
  // バリデーション & 保存処理
  return c.json({ success: true });
});
```

## レスポンシブデザイン

モバイルファーストで実装する。Tailwind CSS のブレークポイント:

| プレフィックス | 最小幅 | 用途 |
|-------------|-------|------|
| (なし) | 0px | モバイル（デフォルト） |
| `sm:` | 640px | 小型タブレット |
| `md:` | 768px | タブレット |
| `lg:` | 1024px | デスクトップ |

### 原則

- デフォルトのスタイルはモバイル向けに書く
- `md:` や `lg:` で大画面向けの上書きを追加
- 画像には `w-full` を基本とし、大画面で `md:w-1/2` 等に制限
- ナビゲーションはモバイルではハンバーガーメニューを検討
- フォントサイズはモバイルで読みやすいサイズ（`text-base` 以上）

### 検証

編集後、Playwright MCP で以下のビューポートでスクリーンショットを確認:
- モバイル (375px)
- デスクトップ (1280px)

## 注意事項

- `data-oc-id` / `data-oc-component` 属性は Vite プラグインが自動注入する。手動で追加しない。
- 画像ファイルは `public/` に配置すると `/` から参照できる。
- ページ間リンクには `<Link to="...">` を使う（`<a href>` ではなく）。
- `import.meta.env.BASE_URL` が BrowserRouter の basename に設定済み。リンクのパスは相対で OK。

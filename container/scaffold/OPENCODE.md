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

## 注意事項

- `data-oc-id` / `data-oc-component` 属性は Vite プラグインが自動注入する。手動で追加しない。
- 画像ファイルは `public/` に配置すると `/` から参照できる。
- ページ間リンクには `<Link to="...">` を使う（`<a href>` ではなく）。
- `import.meta.env.BASE_URL` が BrowserRouter の basename に設定済み。リンクのパスは相対で OK。

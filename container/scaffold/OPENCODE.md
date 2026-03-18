# AI Web Builder — ゲストサイト編集ガイド

## 技術スタック

- React 19 + Tailwind CSS v4 (@import "tailwindcss" 方式、@tailwind ディレクティブは使わない)
- Vite Dev Server (HMR 自動反映)
- Hono (バックエンド API, /api/* にプロキシ)

## ファイル構成

```
src/
├── App.tsx          メインコンポーネント
├── main.tsx         エントリーポイント
└── index.css        Tailwind CSS
functions/
└── api/index.ts     Hono バックエンド API
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

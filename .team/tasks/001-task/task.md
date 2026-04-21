---
id: 001
title: プレビューツールバーに戻る/進む/ホームボタンを追加
priority: medium
created_by: surface:280
created_at: 2026-04-19T12:30:15.913Z
---

## タスク
## 背景

iPad/タッチデバイスでも使えるよう UI 拡張を進めている流れの一環。
現状、iframe 内でリンクをクリックしてページ遷移すると、外側のブラウザ戻るボタンは editor 自体の履歴しか見ないため、**Reload で先頭に戻る以外の脱出手段がない**。

## 対象ファイル

- `editor/src/components/PreviewPanel.tsx` （ツールバー部分、91-123 行目あたり）

## 要件

`PreviewPanel.tsx` のツールバー左端に 3 つのボタンを追加する:

1. **戻る（←）** — `iframeRef.current?.contentWindow?.history.back()`
2. **進む（→）** — `iframeRef.current?.contentWindow?.history.forward()`
3. **ホーム（🏠）** — `iframeRef.current.src = PREVIEW_URL` で初期 URL に戻す

### レイアウト方針

現状:
```
[Inspect ⌘I] | [Desktop][Tablet][Mobile] ............. [Reload]
```

変更後:
```
[←][→][🏠] | [Inspect ⌘I] | [Desktop][Tablet][Mobile] ... [Reload]
```

- 左端に履歴操作、その右に区切り線（既存の `<div className="w-px h-4 bg-gray-600" />` と同じパターン）
- ボタンのスタイルは既存の Reload ボタン（`bg-gray-700 text-gray-300 hover:bg-gray-600`）に合わせる
- アイコンは絵文字でもインライン SVG でもよい（Lucide 等の新規依存は追加しない）

## 注意点

- **同一オリジン iframe 前提で OK**。本番では editor と `/preview/` が同一オリジン。
- ローカル開発では iframe が `http://localhost:5173`（PreviewPanel.tsx:4-6 参照）でクロスオリジンなので `history.back()` は SecurityError になる想定。これは許容（本番動作を優先）。
- `canGoBack` / `canGoForward` の取得はクロスオリジンで不可。ボタンは**常時有効**で問題なし（押せるが履歴がなければ何も起きない、で OK）。
- 既存の Inspect/サイズ切替/Reload の挙動に影響しないこと。

## 完了条件

- [ ] PreviewPanel.tsx にボタン 3 つが追加されている
- [ ] 既存のツールバー要素の見た目が崩れていない
- [ ] 本番ビルド（`npm run build`）が通る
- [ ] 既存テストが通る（`npm test`）
- [ ] 手動確認: iframe 内でリンクを踏んで戻る/進む/ホームがそれぞれ動く（ローカル開発環境ではクロスオリジンで戻る/進むは動かない想定、ホームは動く）

## 非対象（今回やらない）

- アドレスバー（現在 URL 表示）
- canGoBack/canGoForward に応じたボタン無効化
- ローカル開発環境でのクロスオリジン対応

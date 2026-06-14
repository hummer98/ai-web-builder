---
id: 024
title: PreviewPanel の ←/→ ボタンが親ブラウザの履歴を巻き込む問題を修正
priority: high
created_by: surface:63
created_at: 2026-05-07T23:26:09.351Z
---

## タスク
## 背景・症状

本番 (`editor.le-serpent.club`) で右ペインのプレビュー上部にある ← / → / 🏠 のうち
**← / → ボタンを押すと、iframe ではなく親ブラウザ（editor 全体）が前後に遷移してしまう**。
ユーザー報告で発見。実害あり。

ローカル開発 (`npm run dev`) では editor (5174 等) と preview (5173) がクロスオリジンで
SecurityError が catch で握り潰され「何も起きない」ため見落とされていた。

## 原因

`editor/src/components/PreviewPanel.tsx:79-92` の実装:

\`\`\`tsx
const goBack = () => {
  try {
    iframeRef.current?.contentWindow?.history.back();
  } catch { /* ... */ }
};
const goForward = () => {
  try {
    iframeRef.current?.contentWindow?.history.forward();
  } catch { /* ... */ }
};
\`\`\`

HTML 仕様上、同一トップレベルブラウジングコンテキスト配下の iframe の履歴は
親フレームと **joint session history** を共有する。そのため
\`iframe.contentWindow.history.back()\` は joint history を 1 つ戻し、
結果として **親ブラウザ全体が戻る** 挙動になる。
本番では editor と \`/preview/\` が同一オリジンなのでこれが直撃する。

\`PreviewPanel.tsx:78\` のコメントは
「本番は同一オリジンで動作、ローカル開発はクロスオリジンで SecurityError」
と書かれているが、**「同一オリジンで動作」という前提自体が誤り**。
joint history の挙動を考慮できていない。

## 修正方針（推奨）

iframe の \`history.back / forward\` API は使わず、親側で iframe の URL 履歴スタックを
自前管理する:

1. iframe 内のプレビューランタイム（\`container/scaffold/\` 配下、おそらく
   \`container/scaffold/src/main.tsx\` か元ファイル）で
   - 初期表示時に \`postMessage({type:"nav", url: location.href})\` を親へ送る
   - SPA ルーティング後（\`popstate\` / クリックでの \`pushState\` 後）にも同様に通知
2. \`PreviewPanel\` 側で
   - \`historyStack: string[]\` と \`historyIndex: number\` を state として保持
   - \`nav\` メッセージ受信時にスタックへ push（index より先のエントリは破棄）
   - ← ボタン: \`historyIndex > 0\` のとき \`historyIndex--\` し、
     \`iframeRef.current.src = historyStack[historyIndex]\` で遷移
   - → ボタン: \`historyIndex < historyStack.length - 1\` のとき \`historyIndex++\` し同様
   - ボタンは到達不能位置で disabled にする
3. \`iframe.contentWindow.history.back()\` の呼び出しは完全削除する

ポイント:
- \`iframe.src\` の書き換えなら親ブラウザの履歴は触られない
- ただし \`src\` を変えると iframe の history も丸ごと作り直しになるので、
  自前スタックで「論理的な戻る/進む」を実現する設計にする
- ← / → によって iframe をナビゲートしたタイミングは「自前の遷移」なので、
  そのときに iframe からくる \`nav\` メッセージはスタックに追加せず無視するためのフラグ
  （\`isProgrammaticNav\` 等）が必要

## 影響範囲

- \`editor/src/components/PreviewPanel.tsx\` — 主修正
- \`container/scaffold/\` 配下の iframe 側エントリ — \`postMessage({type:"nav"})\` の送信を追加
  （既存の \`element-selected\` 等を送っているスクリプトの近くに足すのが自然）
- \`origin\` 検証は既存の \`PREVIEW_ORIGIN\` 仕組みをそのまま使う
- 🏠（goHome）と Reload は現状維持で OK

## 受け入れ条件（テスト）

1. \`PreviewPanel.test.tsx\` を新規作成し、← / → クリック時に
   \`window.history.back\` / \`window.history.forward\` が呼ばれないことを検証する
   （\`history\` をスパイする vitest テスト）
2. \`postMessage({type:"nav", url: "..."})\` を 2 件送ったあと ← ボタンを押すと、
   iframe の \`src\` が 1 件目の URL に書き換わることを検証
3. \`npm test\` 全体が通ること
4. \`npm run dev\` を起動し、editor を開いて preview 内で何ページか遷移したあと、
   ← を押しても **editor 自体は遷移せず**、iframe だけが戻ること（手動確認 + summary に記録）

## 関連

- 報告者: Master / ユーザー（2026-05-08 セッション）
- 関連ファイル: \`editor/src/components/PreviewPanel.tsx:78-97\`

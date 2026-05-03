# postMessage origin 検証 手動確認手順 (T013)

editor (親) と preview (iframe) 間の postMessage に origin 検証を導入したため、
本番デプロイ後と DEV モードでそれぞれリグレッションを目視確認するための手順。
CI には組み込まない (Playwright で localhost cross-origin 攻撃を再現するのが困難なため)。

## 本番デプロイ後リグレッション確認

1. 本番 URL を開き、AI に「ボタンの色を青にして」と指示
2. PreviewPanel が iframe からのイベント (element-selected / edit-text 等) を受け取って通常編集できることを確認
3. ブラウザ DevTools コンソールに `e.origin !== PREVIEW_ORIGIN` で弾かれた警告がないこと
4. Inspect ボタンをクリックして overlay が正しく表示・クリックハンドラが動くこと

## DEV モードで cross-origin 拒否を再現 (任意)

1. `npm run dev` で起動 (editor :3001 / preview :5173)
2. ブラウザ DevTools で偽の iframe を作って親に postMessage:

   ```js
   const evil = document.createElement('iframe');
   evil.src = 'http://example.com';
   document.body.appendChild(evil);
   evil.contentWindow.postMessage(
     { type: 'element-selected', context: { ocId: 'fake' } },
     '*'
   );
   ```

   → 親 (editor) は反応しないこと (`e.origin !== PREVIEW_ORIGIN` で弾かれる)

## 親 origin の確定戦略 (補足)

| 環境 | 親 origin (editor) | iframe origin (preview) | 同一 |
|------|---------------------|--------------------------|------|
| 本番 (Fly.io) | `https://ai-web-builder.fly.dev` | 同上 (Hono が Vite を proxy) | Yes |
| 本番 (Demo) | `https://ai-web-builder-demo.fly.dev` | 同上 | Yes |
| DEV | `http://localhost:3001` | `http://localhost:5173` | No |

DEV では iframe → 親方向の `postMessage` は `'*'` フォールバックを使う。
脅威モデルは開発機マシン上のみのため許容範囲とする。

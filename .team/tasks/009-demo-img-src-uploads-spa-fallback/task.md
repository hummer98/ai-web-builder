---
id: 009
title: demo: <img src="/uploads/*"> が SPA fallback に落ちる致命バグの修正
priority: high
created_by: surface:529
created_at: 2026-04-21T08:50:49.970Z
---

## タスク
## 背景

T008 (`.team/artifacts/A002-T008-report.md` §8) で発見された致命バグ。画像アップロード改修 B/C でハング自体は 4 分 → 57 秒に解消したが、AI が生成する `<img src="/uploads/<uuid>.<ext>">` が `ai-web-builder-demo` 上で **画像として表示されない**。

## 症状

```bash
$ curl -sI https://ai-web-builder-demo.fly.dev/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png
HTTP/2 200
content-type: text/html; charset=utf-8      # ← SPA fallback が editor index.html を返している

$ curl -sI https://ai-web-builder-demo.fly.dev/preview/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png
HTTP/2 200
content-type: image/png                     # ← Vite 経由なら OK
```

iframe プレビューでヒーロー画像が真っ暗（`bg-black/30` オーバーレイだけが見える）状態になる。`public/uploads/` に実ファイルは保存されているが、agent-server に `/uploads/*` ルートが存在しない。

## 原因（特定済み）

`container/agent-server/src/app.ts`:

- L96-111: `/preview/*` → Vite プロキシ
- L115-133: production の SPA fallback（除外条件は `/ws` `/api` `/preview` `/health` のみ）
- **`/uploads/*` をサーブ/プロキシするルートが無く**、production では SPA fallback に吸収される

## 修正方針（推奨: 方針 1）

1. **推奨**: agent-server に `/uploads/*` を追加し、`WORKSPACE_DIR/public/uploads/` を serveStatic で直接配信（Vite 経由せずシンプル）。SPA fallback 除外条件にも `/uploads` を追加
2. 代替: `/preview/uploads/*` に Vite プロキシさせる方法もあるが、AI 側の URL と乖離するため非推奨

以下の制約を満たす必要がある:

- AI が書く `<img src="/uploads/...">` は最終 Cloudflare Pages デプロイでも動く必要がある（`/preview/` プレフィックスを AI に持たせる方針 2/3 は本番で壊れるため不採用）
- iframe は `/preview/...` 配下で動くが、その中の `<img src="/uploads/foo">` は **親 origin のルート** (`https://<host>/uploads/foo`) にアクセスする。よって agent-server の root 直下に `/uploads/*` を配線する必要がある
- Content-Type は拡張子から判定（.png → image/png, .jpg → image/jpeg, .webp → image/webp, .gif → image/gif, .svg → image/svg+xml）
- パストラバーサル対策（`..` を含む path を弾く）

## 実装詳細

- 修正対象: `container/agent-server/src/app.ts`
- 追加: `app.get("/uploads/*", ...)` ルート
- 修正: SPA fallback 除外条件に `path.startsWith("/uploads")` を追加
- テスト: `container/agent-server/src/app.test.ts` に「GET /uploads/<file> が正しい Content-Type で返る」「パストラバーサル弾き」を追加

## デプロイと動作確認

**禁止: 本番 `ai-web-builder` への一切のアクセス**（閲覧も不要）

1. ローカルで `npm test` → 新規テストが通ることを確認
2. demo (`ai-web-builder-demo`) に deploy
3. demo で T008 と同じ手順で画像アップロードし、ヒーローに画像が **実際に表示される** ことをスクリーンショットで確認
4. curl で `https://ai-web-builder-demo.fly.dev/uploads/<実ファイル>.png` が `content-type: image/png` で返ることを確認

## 成果物

`.team/artifacts/` に実施レポート（A003 相当）:
- 修正した差分サマリー
- 動作確認のスクリーンショット
- curl 結果
- 残課題

## 参考

- レポート: `.team/artifacts/A002-T008-report.md` §8
- コード: `container/agent-server/src/app.ts` L96-133
- 共通インストラクション: `container/instructions/common.md`
- アップロード保存箇所: `container/agent-server/src/app.ts` L60-92 (`/api/upload`)

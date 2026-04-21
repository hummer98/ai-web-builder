---
id: A003
type: report
title: "T009 実施レポート: /uploads/* SPA fallback 致命バグ修正"
created: 2026-04-21T09:12:28.992Z
author: surface:527
---

# T009 実施レポート: `<img src="/uploads/*">` が SPA fallback に落ちる致命バグの修正

- **Task ID**: 009
- **Run ID**: task-009-1776761449
- **Branch**: `task-009-1776761449/task`
- **Role**: Implementer
- **実施日時 (JST)**: 2026-04-21 18:00–18:05
- **デプロイ対象**: `ai-web-builder-demo` (Fly.io `fly.demo.toml`)
- **本番 (`ai-web-builder`) への変更・閲覧**: なし

---

## 1. サマリー

`container/agent-server/src/app.ts` に `GET /uploads/*` ルートを追加し、`WORKSPACE_DIR/public/uploads/<filename>` を `image/*` Content-Type で直接配信するようにした。合わせて production の SPA fallback ミドルウェア (`use("/*")` と `get("/*")` の 2 箇所) の除外条件に `/uploads` を追加し、存在しない `/uploads/<file>` が `index.html` 200 として返る症状を解消した。

TDD で `/uploads/*` 関連 12 ケース（success / 404 系 / SPA fallback 回帰）を先に追加し red を確認してから実装した。

demo (`https://ai-web-builder-demo.fly.dev/`) に deploy し、curl で以下を確認:

- 既存 PNG → `HTTP/2 200` + `content-type: image/png`
- パストラバーサル (`..%2Fetc%2Fpasswd`) → `HTTP/2 404` + `text/plain`
- 存在しないファイル → `HTTP/2 404` + `text/plain` （`text/html` ではない = SPA fallback に落ちていない）
- 既存 `/preview/uploads/<UUID>.png` → 引き続き `HTTP/2 200` + `image/png`

ブラウザ実機スクリーンショットは非必須（curl で根本症状解消が確認できたため）のため今回は取得せず。

---

## 2. 修正差分

```
 container/agent-server/src/app.test.ts | 123 ++++++++++++++++++++++++++++++++-
 container/agent-server/src/app.ts      |  71 ++++++++++++++++++-
 2 files changed, 190 insertions(+), 4 deletions(-)
```

### 2.1 `container/agent-server/src/app.ts` の主要変更

- import 追加: `readFile` from `node:fs/promises`、`resolve`, `sep` from `node:path`
- 定数 `UPLOAD_MIME_TYPES` を追加（`.png / .jpg / .jpeg / .webp / .gif / .svg` の 6 種を網羅、`.svg → image/svg+xml`）
- `app.get("/uploads/*", ...)` ルートを `/api/upload` の直後、`/preview/*` の直前に追加
  - **多層防御**: 早期拒否（`/`, `\`, `..`, 先頭 `.` を含むファイル名を 404）→ 拡張子許可リスト → `resolve` 後の `uploadsDir + sep + rest` 一致チェック → `readFile` の ENOENT は 404
  - `Cache-Control: public, max-age=3600`（UUID で一意なのでキャッシュ可能）
- Production の SPA fallback 2 箇所（`use("/*")` と `get("/*")`）の除外条件に `path.startsWith("/uploads")` を追加

### 2.2 `container/agent-server/src/app.test.ts` の追加テスト

新規 `describe("GET /uploads/*")` を `/api/upload` describe と `auth middleware` describe の間に追加。全 12 ケース:

1. `.png` 200 / `content-type: image/png` + 先頭バイト一致
2. `.jpg` / `.jpeg` 200 / `content-type: image/jpeg`
3. `.webp` / `.gif` / `.svg` それぞれ正しい Content-Type
4. `.PNG`（大文字） 200 / `image/png`
5. 存在しないファイル → 404
6. `..%2Fetc%2Fpasswd` → 404
7. `/uploads/..` → 404
8. `/uploads/sub/a.png`（サブディレクトリ） → 404
9. ドットファイル `.env` → 404
10. 非許可拡張子 `.txt` → 404
11. `WORKSPACE_DIR/public/uploads` 未作成 → 404
12. end-to-end: `POST /api/upload` → レスポンスの `url` で GET して 200 + `image/png`

加えて 13 番目として production SPA fallback 回帰テスト:

13. `NODE_ENV=production` で `/uploads/missing.png` が 404 かつ `content-type` が `text/html` でない

---

## 3. `npm test` 結果

```
 Test Files  14 passed (14)
      Tests  191 passed (191)
   Duration  12.24s
```

追加前: `/uploads/*` 関連で 6 件 failed（200 期待 / SPA fallback 除外期待）。
追加後: 全 191 件 green。

---

## 4. `flyctl deploy` ログ抜粋

```
$ flyctl deploy --config fly.demo.toml --app ai-web-builder-demo --remote-only

--> Build Summary:  ()
--> Building image done
image: registry.fly.io/ai-web-builder-demo:deployment-01KPQMF094C3B93HYNG5WKNN4C
image size: 823 MB

Updating existing machines in 'ai-web-builder-demo' with rolling strategy
> Acquiring lease for 1859d03f399338
> Updating machine config for 1859d03f399338
> Updating 1859d03f399338 [app]
> Machine 1859d03f399338 reached started state
> Running smoke checks on machine 1859d03f399338
> Running machine checks on machine 1859d03f399338
> Checking health of machine 1859d03f399338
✔ Machine 1859d03f399338 is now in a good state
✓ DNS configuration verified

Visit your newly deployed app at https://ai-web-builder-demo.fly.dev/
```

`--config fly.demo.toml` と `--app ai-web-builder-demo` を両方明示。本番 (`fly.toml` / `ai-web-builder`) には一切触れていない。

デプロイ直後の `WARNING The app is not listening on the expected address` は `auto_stop_machines = 'stop'`（`fly.demo.toml` 設定）による停止状態でチェック時点でリスナーが上がっていないだけで、実リクエストで auto-start し正常応答することを §5 で確認済み。

---

## 5. curl 動作確認結果

使用した実ファイル名: `57e83203-e35b-460a-aabe-9eed2ab66bbc.png`（`flyctl ssh console -a ai-web-builder-demo` で `/data/workspace/public/uploads/` を ls して取得、382 B、A002 T008 で使ったサーモンピンク PNG）。

### A) 既存 PNG を直接 GET

```
$ curl -sI https://ai-web-builder-demo.fly.dev/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png
HTTP/2 200
cache-control: public, max-age=3600
content-type: image/png
```

→ **期待通り**。これまで `text/html; charset=utf-8` で返っていた根本症状が解消。

### B) パストラバーサル

```
$ curl -sI https://ai-web-builder-demo.fly.dev/uploads/..%2Fetc%2Fpasswd
HTTP/2 404
content-type: text/plain; charset=UTF-8
```

→ **期待通り**。

### C) 存在しないファイル

```
$ curl -sI https://ai-web-builder-demo.fly.dev/uploads/nonexistent-xxxx.png
HTTP/2 404
content-type: text/plain; charset=UTF-8
```

→ **期待通り**。`content-type` が `text/plain` であり、SPA fallback の `text/html` には落ちていない。

### D) 既存 `/preview/*` プロキシ経路（回帰）

```
$ curl -sI https://ai-web-builder-demo.fly.dev/preview/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png
HTTP/2 200
content-type: image/png
content-length: 382
```

→ **期待通り**。Vite 経由の既存経路も無事に動作している（image-part.ts 等 AI 参照経路を壊していない）。

認証は `flyctl secrets list -a ai-web-builder-demo` の結果 `DEMO_PASSWORD` / `CLOUDFLARE_ACCESS_AUD` どちらも未設定（OPENROUTER_API_KEY / NODE_ENV / GEMINI_API_KEY のみ）なので、auth middleware は「デモモードでスキップ」となり curl に認証ヘッダ不要。

---

## 6. ブラウザ実機スクリーンショット

取得せず（非必須。curl で Content-Type が `image/png` で 200 返ることで根本症状解消は判定可能）。

必要になった場合は、T008 と同条件（382 B サーモンピンク PNG を「この画像をトップのヒーローにして」で投げて AI 編集完了後にプレビュー iframe を確認）で再取得する。

---

## 7. 完了条件チェック

- [x] `npm test` が全 green（191 / 191、新規 13 ケース含む）
- [x] `git status` の変更は `container/agent-server/src/app.ts` と `container/agent-server/src/app.test.ts` の 2 ファイルのみ（本レポートと Taskログを除く）
- [x] demo で curl 確認が成功
  - [x] `/uploads/<UUID>.png` → 200 + `image/png`
  - [x] `/uploads/..%2Fetc%2Fpasswd` → 404
  - [x] `/uploads/nonexistent.png` → 404 かつ `text/html` でない
- [x] `report.md` を書き出し
- [x] commit 禁止を守り `git add` / `git commit` / `git push` を一切実行していない

---

## 8. 残課題・フォローアップ候補

- **ブラウザ実機スクリーンショット**: 非必須のため未取得。A003 等のアーティファクト作成時に可能なら追加する。
- **`WORKSPACE_DIR` の相対パス依存（plan.md §6-2）**: 本タスクでは既存 `/api/upload` と同じ前提（cwd 基準で相対パス解決）を踏襲。ローカル開発時に cwd が想定と異なるとパスが狂う潜在リスクは残るが、demo (`/data/workspace` 絶対) / production (`fly.toml` ベース) では影響なし。別タスク（例: T010 以降）で絶対化を検討するかは要判断。
- **SVG の XSS 対策（plan.md §6-8）**: `image/svg+xml` は iframe 内で `<script>` が実行されうる。本ツールは個人用かつ AI 生成 SVG を信頼前提なので対処せず。必要なら Content-Security-Policy を別タスクで導入。
- **T010 (`010-inactivity-timeout-180s`) / T011 (`011-hono-node-server-err-module-not-found`)**: 本タスクスコープ外、既存タスクとして登録済み。
- **summary.md**: `runs/task-009-1776761449/summary.md` はコンダクター側が完了処理で扱う（Implementer の作業境界外）。
- **.team/artifacts/A003-T009-report.md の登録**: Conductor が完了処理で cmux-team `artifact` skill 経由で登録する想定。

---

## 9. 作業境界の遵守

- [x] 触ったファイル: `container/agent-server/src/app.ts` / `container/agent-server/src/app.test.ts` / `runs/task-009-1776761449/report.md`
- [x] `container/instructions/common.md` は変更していない（AI 側の URL 表記は現行維持で整合する）
- [x] `.team/artifacts/` 直下には書いていない
- [x] 本番 `ai-web-builder`（`fly.toml`）には閲覧・logs・deploy いずれも触れていない
- [x] `git add` / `git commit` / `git push` を実行していない

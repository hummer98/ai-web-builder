---
id: A004
type: research
title: "T011 @hono/node-server ERR_MODULE_NOT_FOUND 調査"
created: 2026-04-21T10:14:03.553Z
author: surface:527
---

# @hono/node-server ERR_MODULE_NOT_FOUND 調査レポート

## 概要

- 警告を出しているのは `start.sh` が起動するゲストサイト用の **Hono dev server プロセス**（`npx tsx watch functions/api/index.ts`、ポート 3000）。
- 根本原因は **`container/scaffold/package.json` に `@hono/node-server` が依存宣言されていない**こと。`functions/api/index.ts:2` で `import { serve } from "@hono/node-server"` しているのに、`npm install` で入らないため起動時に module resolution で即死している。
- 実害あり: **ケース B**。
  1. デモ環境で AI が `/api/contact` を使うコードを生成しても、Hono dev server は起動していないため応答しない（`ai-web-builder-demo.fly.dev/api/health` は agent-server から 404、`/preview/api/health` は Vite プロキシ未一致で HTML フォールバック）。
  2. `container/agent-server/src/deploy.ts:52-58` が `wrangler deploy functions/api/index.ts` を実行するが、依存欠落＋ファイル末尾で `serve({port:3000})` を module top-level で呼ぶ構造のため、Cloudflare Workers でも本番デプロイが成立しない設計。
- 修正は Node.js dev 起動用エントリを分離して scaffold に `@hono/node-server` を devDependency 追加する案を別タスク（下書き §6）として提案。

---

## 1. エラーを出しているプロセス

### 1.1 プロセス特定

`container/start.sh:83` で `tsx watch` 経由で起動される **ゲストサイトの Hono dev server**（port 3000）:

```bash
# container/start.sh:82-83
# Hono Dev Server (バックエンド API)
(cd "$WORKSPACE_DIR" && npx tsx watch functions/api/index.ts 2>&1 | tee -a "$LOGS_DIR/hono.log") &
```

- 作業ディレクトリ: `$WORKSPACE_DIR`（本番は `/data/workspace`、Fly Volume）
- 実行ファイル: `functions/api/index.ts`（scaffold または clone されたゲストリポジトリのもの）
- プロセス名: CLAUDE.md の表で言う「Hono Dev Server（:3000）」

### 1.2 エラーメッセージと発生個所

`functions/api/index.ts:2` で `@hono/node-server` を import し、`:40-49` で `serve()` を module top-level で直接呼んでいる:

```ts
// container/scaffold/functions/api/index.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";                 // ← 解決失敗
// ...
export default app;

// ローカル開発時のスタンドアロン起動
serve({ fetch: app.fetch, port: 3000 }, () => {            // ← モジュール評価時に即実行
  console.log(JSON.stringify({ ... msg: "Hono Dev Server started on :3000" }));
});
```

A001 レポート §4 の flyctl logs 抜粋（再掲）:

```
2026-04-19T14:39:47Z app[...] Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@hono/node-server'
                                imported from /data/workspace/functions/api/index.ts
2026-04-19T14:39:47Z app[...]   code: 'ERR_MODULE_NOT_FOUND'
2026-04-19T14:39:47Z app[...] Node.js v22.22.2
```

### 1.3 発生タイミングとリトライ

- コンテナ（Fly Machine）起動時に `start.sh` から 1 回 spawn → module resolution 失敗で即 `uncaughtException` で落ちる
- `tsx watch` はファイル変更時のみ再評価するため、`functions/api/index.ts` に変更が入るまでプロセスは **永続的にダウン**したまま
- A002 §7 の v40 デプロイでも同じ警告が残っており、v38 → v39 → v40 と再現し続けている（volume の残滓ではなく scaffold 由来）

---

## 2. `@hono/node-server` の依存状況

### 2.1 scaffold の依存宣言

`container/scaffold/package.json` を確認:

```json
// container/scaffold/package.json:11-16
"dependencies": {
  "hono": "^4.7.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "react-router": "^7.13.1"
},
```

**`@hono/node-server` は dependencies にも devDependencies にも存在しない**。`container/scaffold/package-lock.json` にも同パッケージの記述はない（`grep` で確認、該当行 0 件）。peer dep / optional dep でもなく、**単純な依存宣言漏れ**。

他モジュールには正しく宣言されている（`@hono/node-server` は agent-server / log-reader-mcp の package.json に存在）:

```
container/agent-server/package.json:7:    "@hono/node-server": "^1.13.0",
container/log-reader-mcp/package-lock.json:14:    "node_modules/@hono/node-server": { ... }
```

### 2.2 インストールされるかどうか

Dockerfile の scaffold 依存セットアップ:

```dockerfile
# Dockerfile:43-45
# Scaffold の依存を事前インストール（新規サイト作成時にコピーされる）
COPY container/scaffold/ container/scaffold/
RUN cd container/scaffold && npm install
```

`package.json` に無いため当然入らない。`start.sh:52-59` がこの `node_modules` を `$WORKSPACE_DIR/node_modules` に同期するが、欠落パッケージは同期されない。

### 2.3 ローカル再現

仮想環境で確定させた:

```bash
# 1. scaffold を一時ディレクトリにコピー → クリーンインストール
$ TMP=$(mktemp -d); cp -r container/scaffold/. "$TMP/"
$ cd "$TMP" && rm -rf node_modules package-lock.json && npm install
$ ls node_modules/@hono
ls: node_modules/@hono: No such file or directory   # ← hono 本体だけで node-server は無い

# 2. そのまま tsx 起動 → 本番と同じエラー
$ npx --yes tsx functions/api/index.ts
node:internal/modules/run_main:122
    triggerUncaughtException(
    ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@hono/node-server'
    imported from /private/var/folders/.../functions/api/index.ts
  code: 'ERR_MODULE_NOT_FOUND'
Node.js v22.15.0

# 3. 依存を足すと起動 & 応答
$ npm install @hono/node-server@^1.13.0
$ npx --yes tsx functions/api/index.ts &
{"ts":"2026-04-21T10:04:26.027Z","level":"info","service":"hono","msg":"Hono Dev Server started on :3000"}
$ curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' http://localhost:3000/api/health
HTTP=200
```

→ **`@hono/node-server` を devDependency に追加するだけで dev 環境は完全復旧する**ことを確認。

### 2.4 module resolution が見ている場所

`tsx` は Node.js の ESM resolver を使い、`package.json#dependencies`/`devDependencies` ベースで `node_modules` 階層を遡る。workspace 側 `node_modules` に対象が無いので即失敗。root の `/app/package.json` にも `@hono/node-server` は無いため、上位ディレクトリまで遡っても解決しない。

---

## 3. 本番 Cloudflare Pages / Workers への影響

### 3.1 Workers では `@hono/node-server` は不要

Cloudflare Workers は **fetch ハンドラをエクスポートするだけ** で runtime が `fetch(request)` を呼び出すモデル。`@hono/node-server` は Node.js の `http` / `net` などを使うため Workers では動かない。公式の Hono ドキュメントでも Workers 向けは `export default app` のみで `serve()` は使わない（例: [Hono - Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)）。

### 3.2 現行 scaffold は「dev と prod 両立しない設計」

`functions/api/index.ts` はファイル末尾 `L40-49` で module top-level で `serve({port:3000})` を呼ぶ構造:

```ts
// container/scaffold/functions/api/index.ts:37-49
export default app;

// ローカル開発時のスタンドアロン起動
serve({ fetch: app.fetch, port: 3000 }, () => { ... });
```

これは Workers 環境でも **import 時に必ず実行される**。影響:

1. `container/agent-server/src/deploy.ts:52-58` で `wrangler deploy functions/api/index.ts --name ${siteName}-api` が走ると、wrangler の esbuild は `@hono/node-server` を解決しようとし **ビルド失敗する**（package.json に無く、Workers compat のポリフィルも無い）
2. 仮に依存を足してバンドルが通っても、Workers ランタイムには `node:net` `node:http` の完全実装は無く、`serve()` は実行時に失敗する
3. 結果として **`wrangler.toml:3` の `main = "functions/api/index.ts"` は現在の状態では production にデプロイ不能**

### 3.3 開発時 (Fly.io コンテナ内 tsx watch) のみ必要な理由

ローカル / Fly.io ではゲストサイトの API を iframe から叩けるよう「Node.js 単体で :3000 listener を立てる」必要がある。これが `@hono/node-server` の `serve()` の唯一の役割。

正しい構造は:

- `functions/api/index.ts` → `export default app;` のみ（Workers 互換）
- `functions/dev.ts`（新規） → `import app from "./api/index.js"; serve({fetch: app.fetch, port: 3000});` だけ持たせ、`@hono/node-server` は **devDependency**
- `start.sh` を `npx tsx watch functions/dev.ts` に更新
- `wrangler.toml` の `main` は `functions/api/index.ts` のまま

### 3.4 切り分けサマリー

| 環境 | `@hono/node-server` | 現状の動作 |
|---|---|---|
| Fly.io コンテナ内 dev (tsx watch) | 必要 | **落ちている**（依存欠落） |
| Cloudflare Workers (prod) | 不要 | **デプロイ自体が失敗する**（依存欠落 + module top-level で `serve()` 実行） |
| Cloudflare Pages (SPA / dist) | 不要 | 本調査対象外、ただし Pages 側は問題なく配信可能 |

---

## 4. ゲストサイト API の実動作確認

### 4.1 demo 環境への read-only curl

タスク定義で「本番 `ai-web-builder` への deploy / 変更は禁止」とあり、read (GET / HEAD) は変更ではないため実施:

```bash
$ curl -sI https://ai-web-builder-demo.fly.dev/api/health
HTTP/2 404
content-type: text/plain; charset=UTF-8

$ curl -sI https://ai-web-builder-demo.fly.dev/api/contact
HTTP/2 404
content-type: text/plain; charset=UTF-8

$ curl -sI https://ai-web-builder-demo.fly.dev/preview/api/health
HTTP/2 200
(本文 → text/html の index.html。Vite SPA fallback。JSON ではない)

$ curl -sS -X POST -H "content-type: application/json" \
    -d '{"name":"t","email":"a@a","message":"m"}' \
    https://ai-web-builder-demo.fly.dev/preview/api/contact \
    -w '\nHTTP=%{http_code}\n'

HTTP=404
```

### 4.2 解釈

- 直接 `/api/*` を叩くと agent-server の `createApp()` ルート（`container/agent-server/src/app.ts`）に落ちる。agent-server は **`/api/upload` のみ**を処理し他の `/api/*` は一切プロキシしない（`app.ts` 全文 grep 済み: `/api/upload` 以外の `/api/*` ルートなし）。Vite proxy も agent-server 層では効かない。
- `/preview/api/*` を叩くと agent-server の `/preview/*` プロキシ（`app.ts:148-163`）が path 全体を Vite dev server へ転送する。Vite は `vite.config.ts:12-13` で `proxy: { "/api": "http://localhost:3000" }` を持つが、これは path prefix ベースの一致。受け取る path は `/preview/api/health` で prefix が `/api` ではないため **Vite proxy はマッチしない** → Vite はマッチしないパスを SPA dev middleware に流し、結果として `index.html` を text/html で返す。
- つまり **Hono dev server (:3000) は起動していてもしていなくても、demo の iframe から `/api/contact` は到達しない**（iframe の document origin は `https://ai-web-builder-demo.fly.dev`、絶対 URL `/api/contact` は agent-server に行くため）。今回の ERR_MODULE_NOT_FOUND はその上に乗った二次的な壊れ方。

### 4.3 iframe プレビュー経由の実地検証

今回のタスクで Chrome MCP セッションは張らなかった。ただし A002 §8 で Browser MCP を使って確認済み:
- iframe 内の絶対パス `/api/...` は demo の top host に飛び agent-server にヒットして 404 を返す
- `/uploads/*` も同じ原因で SPA fallback になる既知バグ（T009-A で別タスク化済）

本タスクの範囲では「Hono dev server が落ちていることで demo API が応答しない」事実の層を追加確認したのみ。追加の browser E2E 検証は不要と判断した。

### 4.4 ローカル再現で確認したこと

§2.3 で示した通り、scaffold を一時ディレクトリに展開して `@hono/node-server` を手動追加すると `/api/health` は 200 を返す。**依存を追加すれば dev server 側は確かに動く**ことが裏取りできた。

---

## 5. 結論

**ケース B: 実害あり**。根拠:

1. **デモ環境で Hono dev server が永続的に落ちている**（flyctl logs に毎デプロイで出続けている、A001 / A002 §7 / 本調査ローカル再現で一致）。
2. **依存欠落は単純な宣言漏れ**。peer dep でも optional でもなく、`container/scaffold/package.json` に `@hono/node-server` が無いことが原因。
3. **現在の iframe 経由でも `/api/*` は機能していない**（§4）。ただしこれは Hono ダウンの影響というより agent-server / Vite 側のルーティング未整備が主因で、Hono を復活させても iframe から直接は届かない。
4. **Cloudflare Workers デプロイも現状では成立しない**（§3.2）。`deploy.ts` が `wrangler deploy functions/api/index.ts` を実行するが、依存欠落と module top-level `serve()` の二重問題で失敗する。
5. 結果として:
   - **即時の実害**: デモでゲストサイトが自分の API を持てない（友人が「お問い合わせフォームを追加して」と指示しても完成しない）。
   - **潜在的な実害**: 将来 `deploy()` を叩いた瞬間に Cloudflare Workers デプロイが失敗する。T005/T008 の検証ではここまで踏み込んでいなかったので顕在化していないだけ。

本タスクは調査のみで修正しない。次タスクとして §6 の下書きを提案する。

---

## 6. 次タスク下書き（ケース B のため）

以下を `.team/tasks/` 配下に `task.md` として起票することを推奨。Conductor / Master に判断を委ねる:

```markdown
---
id: TBD
title: ゲストサイト Hono dev server 起動失敗と Workers デプロイ未成立の是正
priority: high
created_by: <起票者>
created_at: <ISO date>
---

## 背景

T011 調査 (task-011-1776765605 research.md) により、以下が確定した:

1. `container/scaffold/functions/api/index.ts:2` が `@hono/node-server` を import しているが、`container/scaffold/package.json` に依存宣言がない
2. 結果として Fly.io コンテナ内の `npx tsx watch functions/api/index.ts`（start.sh:83）が起動時に `ERR_MODULE_NOT_FOUND` で即死
3. 同ファイルは末尾で module top-level で `serve({port:3000})` を呼ぶ構造のため、`wrangler deploy functions/api/index.ts`（container/agent-server/src/deploy.ts:52-58）でも
   - 依存解決失敗（@hono/node-server が package.json に無いため wrangler バンドル時にエラー）
   - 仮に依存を足しても Workers ランタイムで `serve()` を実行できず失敗
   という二重の理由で本番デプロイが成立しない

## スコープ

- dev と prod のエントリポイントを分離し、ゲストサイト API が Fly.io（Node.js tsx）でも Cloudflare Workers でも動くようにする
- scaffold の依存宣言を正しい状態に戻す

## 修正方針

1. `container/scaffold/functions/api/index.ts` から `serve(...)` 呼び出しを削除し、**`export default app` のみに純粋化**（Workers 互換）
2. `container/scaffold/functions/dev.ts`（新規、ファイル名は要相談）を作り、以下のみ持たせる:
   ```ts
   import { serve } from "@hono/node-server";
   import app from "./api/index.js";
   serve({ fetch: app.fetch, port: 3000 }, () => {
     console.log(JSON.stringify({
       ts: new Date().toISOString(),
       level: "info",
       service: "hono",
       msg: "Hono Dev Server started on :3000",
     }));
   });
   ```
3. `container/scaffold/package.json` に `@hono/node-server` を **devDependency** として追加（`^1.13.0` 相当、agent-server と揃える）
4. `container/start.sh:83` を `npx tsx watch functions/dev.ts` に更新
5. `wrangler.toml:3` の `main` は `functions/api/index.ts` のまま（Workers 用）
6. テスト:
   - `container/agent-server/src/scaffold-agents.test.ts` 等で scaffold の健全性チェック項目に「`functions/api/index.ts` が Node 固有 API を import しない」を追加（任意、防御的に）

## 完了条件

- [ ] 上記 1〜5 を反映してローカル scaffold に対し `npm install && npx tsx functions/dev.ts` が 200 を返す
- [ ] `ai-web-builder-demo` への deploy 後、`flyctl logs` に `ERR_MODULE_NOT_FOUND: Cannot find package '@hono/node-server'` が **消える**
- [ ] `flyctl ssh console -a ai-web-builder-demo -C 'curl -sS localhost:3000/api/health'` が `{"status":"ok"}` を返す
- [ ] （任意だが推奨）`wrangler deploy --dry-run functions/api/index.ts` がローカルで成功する

## 禁止事項

- 既存ゲストリポジトリ（volume に clone 済みの friend サイト）の `functions/api/index.ts` を破壊的に書き換えない。scaffold の初期ファイルと start.sh / Dockerfile のみ対象
- 本番 `ai-web-builder`（demo でない方）への deploy は引き続き禁止

## 参考

- 調査レポート: `.team/tasks/011-hono-node-server-err-module-not-found/runs/task-011-1776765605/research.md`
- 関連ファイル: `container/scaffold/functions/api/index.ts`, `container/scaffold/package.json`, `container/start.sh`, `container/agent-server/src/deploy.ts`
- 先行 artifact: A001 §5.補足, A002 §7
```

---

## 参考文献

### 読み込んだソースファイル

- `CLAUDE.md` — 「コンテナ内プロセス」「ログ」「テスト方針」
- `container/start.sh:1-91`（全文）— 4 プロセス起動、Hono dev server は L83
- `container/scaffold/package.json:1-32`（全文）— `@hono/node-server` 宣言なしを確認
- `container/scaffold/package-lock.json:1-50`（抜粋 + grep）— 同上、lockfile にも無し
- `container/scaffold/functions/api/index.ts:1-50`（全文）— L2 で import, L40-49 で module top-level の `serve()`
- `container/scaffold/vite.config.ts:1-28`（全文）— L12-13 の `proxy: { "/api": "http://localhost:3000" }`
- `container/scaffold/wrangler.toml:1-16`（全文）— `main = "functions/api/index.ts"`
- `container/agent-server/src/app.ts:1-201` — `/api/upload` 以外の `/api/*` ルート無しを確認
- `container/agent-server/src/deploy.ts:40-75` — `wrangler deploy functions/api/index.ts` を呼ぶ箇所
- `Dockerfile:1-67` — L43-45 で scaffold の npm install を確認

### 先行 artifact

- `.team/artifacts/A001-research.md` §4, §5 補足 — 最初の観測
- `.team/artifacts/A002-T008-report.md` §7 — v40 でも同警告が残存

### 実行した主要コマンド

```bash
# ローカル再現（tmp dir）
mktemp -d
cp -r container/scaffold/. "$TMP/"
rm -rf node_modules package-lock.json && npm install --no-audit --no-fund
npx --yes tsx functions/api/index.ts                                   # → ERR_MODULE_NOT_FOUND
npm install --no-audit --no-fund @hono/node-server@^1.13.0
npx --yes tsx functions/api/index.ts                                   # → "Hono Dev Server started on :3000"
curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' http://localhost:3000/api/health  # → HTTP=200

# demo への read-only curl
curl -sI https://ai-web-builder-demo.fly.dev/api/health                # → 404 text/plain
curl -sI https://ai-web-builder-demo.fly.dev/api/contact               # → 404 text/plain
curl -sI https://ai-web-builder-demo.fly.dev/preview/api/health        # → 200 text/html (Vite SPA fallback)
curl -sS -X POST -H 'content-type: application/json' \
     -d '{"name":"t","email":"a@a","message":"m"}' \
     https://ai-web-builder-demo.fly.dev/preview/api/contact           # → HTTP=404
```

### 外部資料（一次）

- Hono - Cloudflare Workers: https://hono.dev/docs/getting-started/cloudflare-workers
- `@hono/node-server` npm: https://www.npmjs.com/package/@hono/node-server

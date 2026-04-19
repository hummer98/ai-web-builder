---
id: A001
type: research
title: "T005: demo 画像アップロード 4 分ハングの再現と原因特定"
created: 2026-04-19T14:51:57.571Z
author: surface:279
---

# T005 / 調査レポート: demo 環境で画像アップロード時に SSE が長時間返らない事象

## 1. 概要

- **調査日時**: 2026-04-19 23:37 JST (14:37 UTC) — 23:44 JST (14:44 UTC)
- **調査対象**: `ai-web-builder-demo`（`https://ai-web-builder-demo.fly.dev/`、`fly.demo.toml`）
- **調査目的**: 画像添付 + 非エンジニアペルソナのプロンプト送信時に「OpenCode が SSE を返さずハングする」事象の再現と真因特定
- **結論サマリー**:
  1. 事象は再現した。ただし「完全な無応答」ではなく、**Claude は LLM 応答を開始 → opencode 組み込みの `read` ツールを実行 → 以降の tool-call ループで長時間完了しない**状態だった。
  2. 真因は MCP 初期化 stall ではなく、**multimodal でないプロンプト設計と曖昧な画像 URL のため、Claude が画像の実体を把握するために余分な tool-call ループ（read → 参照解決 → ソース読込 → 編集 → 検証）を回している**こと。プロンプトが text-only のため Claude は画像を「見る」ことができず、結果としてラウンド数が増える。
  3. 改修案のうち **C（promptAsync の multimodal 化）が真因に直接効く**。続いて **B（AGENTS.md 追記でラウンド短縮）**、**D（deadline/timeout で UX ガード）** の順で優先度を上げるべき。A と E は真因に直接効かない。

## 2. 実施手順とタイムライン

すべて UTC（Fly ログに合わせる）。JST は +9 時間。

| UTC 時刻 | 事象 |
|---------|------|
| 14:37:50 | `flyctl deploy -c fly.demo.toml` 実行開始 |
| 14:38:27 | Fly がコンテナイメージを pull 開始 |
| 14:38:48 | v39 リリース complete（`flyctl releases` で確認） |
| 14:39:31 | Machine 起動（stopped → started）、`/app/start.sh` 実行開始 |
| 14:39:44 | opencode serve が `0.0.0.0:4096` で listen |
| 14:39:45 | Vite dev server ready（`:5173/preview/`） |
| 14:39:47 | **Hono dev server 起動失敗**: `ERR_MODULE_NOT_FOUND: @hono/node-server`（後述、今回の事象とは別問題） |
| 14:39:47 | Agent Server が `0.0.0.0:8080` で listen |
| 14:40:19 | ブラウザから `/` GET → `/health` 初回 200（cold start ~20s）、エディター UI ロード |
| 14:40:19.789 | WS `/ws` connected、OpenCode client 作成 |
| 14:40:20.353 | OpenCode SSE `server.connected` 受信 |
| 14:40:44.093 | `POST /api/upload` 成功（`7525ac72-...png`、382 bytes） |
| 14:40:44.108 | WS `chat` メッセージ受信 |
| 14:40:44.134 | OpenCode `session.create` 完了（`ses_259d031acffe16aexwqsIsYBXT`） |
| 14:40:44.148 | **`promptAsync` 送信完了**（= ハング観測開始点） |
| 14:41:xx | UI に「添付画像を確認して、現在のサイト構成を確認します。」のストリームが表示 |
| 14:41:xx | UI に「● read」（ツール実行中ステータス）が表示 |
| 14:44:10 | 観測終了時点で**まだ `session.status=idle`（stream-end）未到達**、UI は「● read」のまま |

プロンプト送信から観測終了までの経過時間: **約 3 分 22 秒**（14:40:44 → 14:44:06）。タスク定義の「約 4 分」と整合。

## 3. 再現結果

- **再現可否**: 再現した（プロンプト送信から少なくとも 3 分 22 秒、観測終了まで応答完了せず）
- **ブラウザ側の挙動**:
  - 送信直後にチャット末尾にユーザー投稿「この画像をトップのヒーローにして [画像添付: test-hero.png]」が出る
  - 数秒〜十数秒後に AI アシスタントの最初の文「添付画像を確認して、現在のサイト構成を確認します。」が**部分的に**ストリーム表示される
  - その下にツール実行ステータスとして「● read」が表示されたまま、以降更新が来ない
  - `stream-end` / `git commit` / エラーのいずれも UI に届かず
- **Agent Server ログ**: `promptAsync sent` 以降、**新規ログ 0 件**（`handleEvent` 内部は ws.send のみで log 出力しない実装）
- **ブラウザ console**: Vite HMR の WebSocket エラーが定常的に出ているのみ（今回の事象とは無関係）

## 4. ログ抜粋（関連箇所）

以下は `flyctl logs -a ai-web-builder-demo` の該当箇所（タイムスタンプ色付け ANSI は省略、内容はそのまま）。

```
2026-04-19T14:39:44Z app[...] opencode server listening on http://0.0.0.0:4096
2026-04-19T14:39:45Z app[...]   VITE v6.4.1  ready in 1975 ms
2026-04-19T14:39:45Z app[...]   ➜  Local:   http://localhost:5173/preview/
2026-04-19T14:39:47Z app[...] node:internal/modules/run_main:123
2026-04-19T14:39:47Z app[...]     triggerUncaughtException(
2026-04-19T14:39:47Z app[...]     ^
2026-04-19T14:39:47Z app[...] Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@hono/node-server'
                                  imported from /data/workspace/functions/api/index.ts
2026-04-19T14:39:47Z app[...]   code: 'ERR_MODULE_NOT_FOUND'
2026-04-19T14:39:47Z app[...] Node.js v22.22.2
2026-04-19T14:39:47Z app[...] {"ts":"2026-04-19T14:39:47.859Z","level":"info","service":"agent-server",
                                "msg":"Agent Server started on 0.0.0.0:8080"}

2026-04-19T14:40:19Z app[...] {"ts":"2026-04-19T14:40:19.789Z","level":"info","service":"agent-server",
                                "msg":"WS connected"}
2026-04-19T14:40:19Z app[...] {"ts":"2026-04-19T14:40:19.789Z","level":"info","service":"agent-server",
                                "msg":"OpenCode client created","url":"http://localhost:4096"}
2026-04-19T14:40:20Z app[...] {"ts":"2026-04-19T14:40:20.353Z","level":"info","service":"agent-server",
                                "msg":"Event stream connected","type":"server.connected"}
2026-04-19T14:40:20Z app[...] 2:40:20 PM [vite] (client) page reload opencode.json

2026-04-19T14:40:44Z app[...] {"ts":"2026-04-19T14:40:44.093Z","level":"info","service":"agent-server",
                                "msg":"File uploaded","filename":"7525ac72-0a0c-4c22-aced-d47672101c12.png",
                                "size":382}
2026-04-19T14:40:44Z app[...] {"ts":"2026-04-19T14:40:44.108Z","level":"info","service":"agent-server",
                                "msg":"WS message received","type":"chat"}
2026-04-19T14:40:44Z app[...] {"ts":"2026-04-19T14:40:44.134Z","level":"info","service":"agent-server",
                                "msg":"OpenCode session.create response","res":"{\"data\":{\"id\":
                                \"ses_259d031acffe16aexwqsIsYBXT\",\"slug\":\"calm-circuit\",
                                \"version\":\"1.14.18\", ... \"directory\":\"/data/workspace\", ...}}"}
2026-04-19T14:40:44Z app[...] {"ts":"2026-04-19T14:40:44.134Z","level":"info","service":"agent-server",
                                "msg":"OpenCode session created","sessionId":"ses_259d031acffe16aexwqsIsYBXT"}
2026-04-19T14:40:44Z app[...] {"ts":"2026-04-19T14:40:44.148Z","level":"info","service":"agent-server",
                                "msg":"promptAsync sent","sessionId":"ses_259d031acffe16aexwqsIsYBXT"}

--- ここから観測終了（14:44:10Z）まで 3 分 22 秒間、opencode / agent-server とも新規ログなし ---
```

**UI 側で観測された応答テキスト**（`evaluate_script` でチャットパネル内の innerText を取得）:

```
AI Web Builder
? 使い方 📋 履歴 ↶ 元に戻す 公開
この画像をトップのヒーローにして
[画像添付: test-hero.png]

添付画像を確認して、現在のサイト構成を確認します。

● read
送信
```

→ LLM は少なくとも 1 回の応答を返し、`read` ツールが running 状態でステータス表示されている。agent-server の `handleEvent()` は `message.part.delta` と `message.part.updated(running)` の両方を WS に送っているため、**SSE は流れているが `session.status=idle` には到達していない**。

## 5. 真因の推定と根拠

### 観測事実

1. `promptAsync sent` の時点で OpenCode SSE `server.connected` は既に確立（14:40:20 ＜ 14:40:44）
2. LLM (Claude via OpenRouter) は応答テキストを返し始めている（UI にストリーム表示）
3. Claude は `read` ツール（opencode 組み込み、MCP ではない）を実行中
4. 3 分超経過しても `session.status.idle` 未到達 → tool-call ループ継続中
5. MCP 固有のログ（`MCP server 'playwright' started` 等）は一切観測されていない

### 根拠に基づく真因の絞り込み

| タスク定義の候補 | 該当性 | 根拠 |
|-----------------|-------|------|
| MCP 初期化で stall | ❌ 該当しない | LLM 応答が既に返っており、`read` は組み込みツール。playwright/nano-banana/log-reader のいずれも未起動。MCP は tool 呼び出し時に初めて spawn されるが、この観測時点ではまだ呼ばれていない。 |
| LLM 呼び出しが走っていない | ❌ 該当しない | UI に最初の応答テキストが streaming 表示されている |
| 相対 URL `/uploads/<uuid>.<ext>` を Claude が fetch して失敗 | △ 部分的 | Claude は `read` ツールでファイルを直接読もうとしている可能性が高い。`/uploads/<uuid>.png` は URL としては Vite 経由では `/preview/uploads/...` でしか到達できず、そもそも LLM から HTTP fetch は素直にはできないので `read` 経由で `/data/workspace/public/uploads/<uuid>.png` を読むしかない |
| Claude 側で tool call 連打 | ✅ **最有力** | `read` が出ていることに加え、AGENTS.md が編集後必ず `browser_screenshot`・`browser_console_messages`・`read_log` を要求するため、最低でも 5〜6 ラウンドの tool-call を要する設計。1 ラウンドあたり Claude/OpenRouter のレイテンシ + tool 実行で 15〜40 秒 ⇒ 合計 3〜5 分は容易に到達する |

### 決定打となる設計上の問題

**`buildPrompt` は `imageUrl` を「テキストとして URL 文字列を埋め込むだけ」で、Claude への multimodal 入力には渡していない**（`container/agent-server/src/utils.ts:42-47`）:

```ts
if (data.imageUrl) {
  parts.push("## 添付画像");
  parts.push(`- URL: ${data.imageUrl}`);
  parts.push("この画像をサイトで使用してください。");
  parts.push("");
}
```

さらに `promptAsync` 呼び出しも **text part のみ**（`container/agent-server/src/index.ts:117-122`）:

```ts
await opencode.session.promptAsync({
  path: { id: currentSessionId },
  body: {
    parts: [{ type: "text", text: prompt }],
  },
});
```

→ Claude は「`/uploads/<uuid>.png` という相対 URL の画像がある」という文字列を見るだけで、画像内容は一切見えていない。そのため Claude は:

1. まず画像の実体を把握しようとして `read /uploads/<uuid>.png`（または絶対パス）を試す
2. `read` が PNG の画像バイナリ（opencode は read 時に image 判定して multi-part で LLM 次ラウンドに添付する実装があるが、それでもラウンドが 1 つ増える）
3. 続いてサイト構成を把握するため `src/pages/Home.tsx` や `src/components/HeroSection.tsx` 等を複数 `read`
4. `edit` でソースを書き換え
5. AGENTS.md 指示に従い `browser_screenshot` → `browser_console_messages` → `read_log` の 3 連続検証

のように、**最小でも 7〜8 ラウンドの LLM + tool 往復**が生じる。加えて、4 の時点で playwright MCP が初めて spawn されるため、コールド状態では Chromium 起動に数十秒〜1 分程度を要する。これらが積み上がって数分の「ハング」に見える。

### 補足: Hono が落ちている件は別問題

`14:39:47Z` に Hono プロセスは `ERR_MODULE_NOT_FOUND: @hono/node-server` で落ちているが、これは Fly Volume `workspace_data` に残っている v38 時代の `node_modules` と新 scaffold `functions/api/index.ts` の不整合が原因。画像アップロードハング事象とは直接関係しない（アップロード自体は Agent Server :8080 が処理している）。ただし demo 環境では放置すると `POST /api/contact` 等が落ちるので、**ボリュームのリセットか scaffold 同期ロジックの強化**は別途必要。

## 6. 改修案 A〜E の評価

| 案 | 内容 | 真因への直接効果 | 優先度 | コメント |
|----|------|------|------|---------|
| **A** | `buildPrompt` 強化（絶対パス追記、サイズ情報付与など） | △ 弱い | 低 | Claude が画像の「存在」を知る材料は増えるが、**本体を「見る」ようにはならない**ので余分ラウンドが減る効果は限定的 |
| **B** | `AGENTS.md` に「アップロード画像は `public/uploads/` にある。そのまま `<img src="/uploads/xxx">` で使えばよく、`read` する必要はない」と明記 | ◯ 中程度 | 中〜高 | ラウンド数を 3〜5 → 1〜2 に削れる。ただし検証フェーズは残るので「スピード改善」であり根治ではない。C の前提としても有効 |
| **C** | `promptAsync` の multimodal 化（`parts` に `{ type: "file", mime, url }` や base64 image を追加） | ◎ **直接効く** | **最高** | Claude が画像を直接「見れる」ため、「画像が何か調べるための read ラウンド」が丸ごと不要になる。非エンジニアが「この画像をヒーローにして」と指示する本来のシナリオが初めて成立する。OpenRouter 経由 Claude は multimodal 対応、opencode SDK も file part をサポートしている |
| **D** | deadline / timeout 導入 | △ 症状対処 | 中 | 根治ではないが、非エンジニアの UX を守る観点で必須（現状は「押した直後から 4 分無音」で諦める）。30〜60 秒でハートビート的な「作業中…」メッセージ、3 分で「時間がかかりすぎています。再試行しますか？」のような表示が妥当 |
| **E** | `public/uploads/` 統合（パス正規化など） | ✕ 該当せず | 低 | 今回の原因は URL の配置ではなく、**text-only プロンプト設計**。`/uploads/` の URL は Vite base=`/preview/` 配下で到達可能なので、E を実装しても真因は解消しない。優先度を下げるべき |

### 推奨する実装順序

1. **C（multimodal 化）** をメインに着手。これだけで「Claude が画像を見て、直接 HeroSection.tsx を書く」ことが可能になり、最小 1〜2 ラウンドで完了できる見込み
2. **B（AGENTS.md 追記）** を同時または直後に。C を入れても AGENTS.md に残る「必ず read して検証」の文化は残るので、画像については「uploads 配下のものは read せず src に直結せよ」の但し書きを追加
3. **D（timeout / ハートビート UI）** を次に。C + B でも検証フェーズで playwright MCP の初回 spawn が数十秒かかる事情は変わらないので、ユーザー向けに「◯◯ を確認しています…」のステータス更新を UI 側で積極的に行う
4. A は C で不要化される（画像の絶対パスやサイズを伝える意義が消える）
5. E は別の動機（例: production build 時の assets 統合など）が出たときに再検討

## 7. 追加で必要な調査

今回の観測では `session.status.idle` 到達まで追えなかった（ユーザー指示で 3 分 22 秒で停止）。次に必要なのは:

1. **フル完走ログ**: 10〜15 分放置してどのラウンドで完了/失敗するかを確認する。特に:
   - `read` の後に何の tool が走るか（`bash` / `edit` / `browser_screenshot` 等）
   - playwright MCP の初回 spawn で本当に遅延するか（`MCP server 'playwright' started` の timestamp）
   - 最終的に `session.status.idle` になるか、`session.error` になるか
2. **opencode 自体の詳細ログ**: 現在 opencode は `/app/logs/opencode.log` にプレーンテキスト出力のみ。`OPENCODE_LOG_LEVEL=debug` 相当のフラグで内部 tool 実行トレースを取れないか要確認（見つかればラウンド数と各段階のレイテンシが一目で分かる）
3. **opencode `read` の画像取り扱い**: PNG を `read` した場合に SDK が multi-part で LLM に食わせているかを `@opencode-ai/sdk` 側で確認。もし既に multi-part 化されているなら C はむしろ「promptAsync 直送」の最適化、そうでなければ C は必須修正
4. **Hono ERR_MODULE_NOT_FOUND の volume 問題**: v38 時代の `/data/workspace/node_modules` と新 scaffold の差分を常に同期する `start.sh` のロジック（`package-lock.json` 比較）が今回機能しなかった理由の追跡。`/data/workspace/functions/api/index.ts` に対する node_modules lookup が workspace 側で行われていない可能性
5. **cold start レイテンシの影響分離**: 本調査はデプロイ直後の初回アクセスだったため、2 回目アクセス時（warm start、MCP キャッシュあり）でも同じ時間がかかるかの比較検証

## 8. 参考（読んだファイル・実行コマンド）

### 読んだソースファイル

- `container/start.sh` — 4 プロセス起動と GEMINI_API_KEY 注入の流れ
- `container/agent-server/src/index.ts` — WS ハンドラー、`promptAsync` 呼び出し（L117-122）、`handleEvent` での SSE → WS 変換
- `container/agent-server/src/utils.ts` — `buildPrompt` の imageUrl 埋め込み（L42-47）
- `container/agent-server/src/app.ts` — `/api/upload` 実装（WORKSPACE_DIR/public/uploads/ に保存し `/uploads/<uuid>.<ext>` を返す）
- `container/scaffold/opencode.json` — MCP 設定（playwright / log-reader / nano-banana）
- `container/scaffold/vite.config.ts` — `base: VITE_BASE_PATH ?? "/"` の base 設定（start.sh で `/preview/` が渡される）
- `container/scaffold/AGENTS.md` — 編集後の必須検証フロー（screenshot / console / read_log の 3 連続）
- `editor/src/components/ChatPanel.tsx` — `/api/upload` 呼び出しと `chat` メッセージ送信（L243-305）
- `fly.demo.toml` — demo 環境の VM / mount 設定
- `.team/tasks/005-demo-4/task.md` — タスク定義

### 実行した主要コマンド

- `flyctl status -a ai-web-builder-demo`
- `flyctl secrets list -a ai-web-builder-demo`
- `flyctl releases -a ai-web-builder-demo`
- `flyctl deploy -c fly.demo.toml`
- `flyctl logs -a ai-web-builder-demo`（`--no-tail` 含む）
- `magick -size 800x600 xc:lightblue /tmp/task-005/test-hero.png`
- `curl -s -o /dev/null https://ai-web-builder-demo.fly.dev/health`（machine wake-up）
- Chrome MCP: `new_page` / `take_snapshot` / `upload_file` / `fill` / `click` / `list_console_messages` / `evaluate_script`

### 作業メモ保存先（worktree 外）

- `/tmp/task-005/deploy.log` — デプロイ出力
- `/tmp/task-005/demo-logs-full.txt` — 送信完了直後までの Fly ログ（55 行）
- `/tmp/task-005/demo-logs-late.txt` — 観測終了時点までの Fly ログ（33 行）
- `/tmp/task-005/test-hero.png` — 送信テストに使った 800x600 水色 PNG（382 bytes）

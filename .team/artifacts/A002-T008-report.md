---
id: A002
type: report
title: "T008: demo 画像アップロード改修 B/C/D 動作確認"
created: 2026-04-21T07:54:36.465Z
author: surface:278
---

# T008 動作確認レポート

- **実施日時**: 2026-04-21 07:39〜07:45 UTC（= 16:39〜16:45 JST）
- **検証環境**: `ai-web-builder-demo` v40（image: `registry.fly.io/ai-web-builder-demo:deployment-01KPPYVWP60HGP2W1GJ1FA17NQ`、machine `1859d03f399338`）
- **検証者**: Researcher Agent（task-008-1776756835）
- **関連 Artifact**: [A001-research.md](../../../../artifacts/A001-research.md)（T005 調査）

---

## 1. 結論サマリー

| 改修 | 結果 | 補足 |
| --- | --- | --- |
| **B** (`common.md` に multimodal 画像ガイダンス) | **機能した** | AI は画像を `read` せず直接 `edit` に進んだ。T005 の tool-call ループは消失 |
| **C** (`promptAsync` multimodal 化) | **機能した** | `partCount=2 hasImage=true` のログと、AI が画像の色（サーモンピンクの単色）を言語的に認識している事実で確認。4 分超のハング → **57 秒で完了** |
| **D** (180s SSE 無応答 abort + ws timeout) | **正常ケースでは発火せず（期待どおり）** | 57s / 11s の 2 回ともタイムアウト前に `session.status=idle` で `timer.stop()`。意図的 stall による発火試験は未実施（busybox に `ps` 無く断念）。コードパス上は `chat-handler.ts` / `timeout.ts` で実装済み |
| **回帰**（画像なしプロンプト） | **問題なし** | `partCount=1 hasImage=false`、11 秒で完了、想定どおり `bg-black/30`→`bg-black/50` に変更 |

### ただし T006 とは独立した**致命的な表示バグ**を新規発見

- AI は共通インストラクション通り `<img src="/uploads/<uuid>.<ext>" alt="..." />` を生成したが、**この URL はブラウザから 200 text/html（SPA fallback）を返し、画像が表示されない**
- `public/uploads/` に実ファイルは保存されており、`/preview/uploads/<uuid>.<ext>` なら 200 image/png を返す
- agent-server に `/uploads/*` をプロキシするルートが存在しないのが原因（詳細は §8）
- **T006 改修 B/C の効果（ハング解消・AI への正しい指示）自体は成立しているが、ユーザー視点では「画像アップロードするとヒーロー背景が真っ暗になる」という別の壊れ方になっている**
- 次タスクとして `/uploads/*` ルーティング修正を起票することを推奨

---

## 2. 再現テスト結果（golden path）

### 2.1 条件

- URL: `https://ai-web-builder-demo.fly.dev/`
- 画像: 382 B の PNG（サーモンピンク単色、`test-hero.png`）
- プロンプト: 非エンジニアペルソナ「この画像をトップのヒーローにして」（ファイル名・コンポーネント名を含めない）
- ブラウザ: Chrome MCP（`mcp__chrome-tayorie__*`）

### 2.2 タイムライン（flyctl logs 抜粋）

```text
07:39:03.757Z agent-server       File uploaded filename=57e83203-...png size=382
07:39:03.767Z agent-server       WS message received type=chat
07:39:03.793Z chat-handler       OpenCode session created sessionId=ses_251058721ffeYDKVyDwTz6U2wD
07:39:03.814Z chat-handler       promptAsync sent partCount=2 hasImage=true
07:40:00.508Z agent-server       OpenCode response completed (stream)   ← 先行 grep 済み
07:40:00.602Z agent-server       Auto-committed hash=fde815f message="AI edit"
```

**送信 → 完了所要時間: 約 56.7 秒**（T005 の 4 分超ハングから劇的に改善）

### 2.3 観察された SSE / WS イベント（抜粋）

- `message.part.updated`（`step-start` / `text` / `tool` 系）がフロントに継続的に届き、進捗メッセージがチャット欄で更新された
- `session.status=idle` 到達で inactivity timer が stop（呼ばれず）
- 途中の tool 呼び出しは **`edit`（書き込み）のみ**。T005 時に頻発していた画像ファイルへの `read` は **発生しなかった**

### 2.4 AI が行った変更（commit `fde815f`）

```diff
# src/components/HeroSection.tsx
-<section id="hero" className="... bg-gradient-to-br from-warm-50 via-warm-100 to-warm-200 ...">
+<section id="hero" className="relative min-h-screen flex items-center justify-center overflow-hidden">
+  <img
+    src="/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png"
+    alt="サーモンピンクのヒーロー背景"
+    className="absolute inset-0 w-full h-full object-cover"
+  />
+  <div className="absolute inset-0 bg-black/30" />
```

- `<img>` で配置されている（`backgroundImage` ではない → common.md の方針どおり）
- `alt` に日本語で文脈に即した説明が入っている（「サーモンピンクのヒーロー背景」）
- 挿入先が妥当（既存の `HeroSection.tsx`）

### 2.5 プレビュー実機表示

- スクリーンショット: `screenshot-02-hero-current.png`
- 期待: サーモンピンクの画像が背景に敷かれ、その上にタイトル
- 実際: **画像が読み込まれず、`bg-black/30` のオーバーレイのみが見える状態でタイトルが表示**（§8 で詳細）
- つまり「AI の編集結果自体は正しいが、URL スキームが壊れている」状態

### 2.6 副次観察: AGENTS.md を AI が勝手にリファクタ

- 同一コミット `fde815f` で `AGENTS.md` が -96 行の整理、`opencode.json` に 5 行の差分
- 指示には含まれないため副次編集。T008 の結論には影響しないが、記録として残す
- common.md 改修で "`read` しない" 方針を教えたことで浮いた思考時間が別の編集に使われた可能性あり

---

## 3. 改修ごとの効果検証

### 3.1 B — `container/instructions/common.md` への multimodal ガイダンス追加

- **動いた判定: Yes**
- **確認手段**
  - T005 で頻発していた「画像を `read` ツールで読みに行く」動作が **今回は一切発生しなかった**（log に `tool=read path=public/uploads/...` が 0 件）
  - AI の進捗メッセージに「まず現在のファイル構成を確認します」→ `edit` へ直行
- **注意点**: 共通ガイダンスに `<img src="/uploads/<uuid>.<ext>">` と書かれており、AI はそれに従った。§8 のバグはこの "`/uploads/*` は公開されているはず" という前提が実態と一致していないことに由来する

### 3.2 C — `promptAsync` の multimodal 化

- **動いた判定: Yes**
- **確認手段**
  1. log: `promptAsync sent sessionId=... partCount=2 hasImage=true`（`chat-handler.ts` 116-120 行）
  2. AI の進捗メッセージ内容: 「サーモンピンク（単色）の画像ですね」と色を言語化 → LLM が **画像バイト列を実際に見ている**証拠
  3. 所要時間: **4 分 → 57 秒**。T005 の tool-call ループ（text-only が原因）が消失した
- **実装確認**
  - `container/agent-server/src/chat-handler.ts`
  - `container/agent-server/src/image-part.ts`（`buildImagePart()` が data URL を生成）
- **備考**: `image-part.ts` は `<workspaceDir>/public/uploads/<filename>` を読みに行く。`filename` は `data.imageUrl` の末尾から抽出するので、§8 のルーティング問題があっても **モデル側の見え方は正しい**（本件とは独立）

### 3.3 D — 180s SSE 無応答 abort + ws timeout メッセージ

- **判定: 正常ケース非発火（期待どおり）。意図的 stall による発火確認は未実施**
- **確認手段（正常ケース側）**
  - 計測: 1 回目 57s、2 回目 11s。どちらも `INACTIVITY_TIMEOUT_MS=180_000` 未満
  - ログ上 `aborting due to inactivity` / `session.error` / `timeout メッセージ` の送信は 0 件
  - SSE 進捗が継続的に届く間、`inactivityTimer.reset()` が呼ばれ、`session.status=idle` で `timer.stop()` → onTimeout 非発火
- **実装確認**
  - `container/agent-server/src/index.ts`: `const INACTIVITY_TIMEOUT_MS = 180_000` / `createInactivityTimer(...)` の統合
  - `container/agent-server/src/chat-handler.ts`: `runInactivityTimeout` に abort + ws error（「AI の応答が 3 分間ありませんでした。もう一度送ってください。」）
  - `container/agent-server/src/timeout.ts`: `reset()` / `stop()` の単純なタイマー
  - 単体テストは `timeout.test.ts` に fake timers で存在
- **発火確認が未実施の理由**
  - Fly Machine の busybox shell に `ps` / `kill` の拡張フラグが無く、SIGSTOP による opencode 一時停止が試行不能
  - 他の方法（非常に長い生成を強制するプロンプト等）は 180s を超える保証が無く、本番 API コストを無駄に消費するため断念
  - コードパス・単体テスト・正常ケースの非発火挙動から「実装は動くはず」と判断し、実発火試験は task-010 等の次タスクに回すことを推奨

---

## 4. timeout 発火検証（改修 D）

上記 §3.3 のとおり、**今回は正常ケースの非発火を確認**するに留まった。

- 1 回目（画像あり、`fde815f`）: 07:39:03.814Z → 07:40:00.508Z = **56.7s**
- 2 回目（画像なし、`3099b95`）: 07:41:21.422Z → 07:41:32.677Z = **11.3s**
- 両方とも `session.status=idle` で `timer.stop()`、WS への timeout エラーメッセージは 0 件

意図的 stall によるテストは別途専用タスクを切ることを推奨（§9 提案 T009-B）。

---

## 5. 回帰チェック（画像なしプロンプト）

- プロンプト: 「ヒーローの暗いオーバーレイをもう少し濃くして」（ペルソナ的に妥当な曖昧指示）
- ログ: `promptAsync sent partCount=1 hasImage=false`
- 完了: 11.3 秒
- 変更: commit `3099b95`、`HeroSection.tsx` で `bg-black/30` → `bg-black/50` のみ
- 判定: **回帰なし**。改修 C の分岐が画像なしパスを壊していない

---

## 6. スクリーンショット

- `screenshot-01-hero-after.png` — 画像なし 2 回目編集後（オーバーレイ濃度変更後の状態）
- `screenshot-02-hero-current.png` — 画像あり編集直後のプレビュー。**ヒーロー部分に画像が表示されず、オーバーレイだけが見える**状態で、§8 のバグを視覚的に示している

いずれも `.team/tasks/008-demo/runs/task-008-1776756835/` に保存済み。

---

## 7. `flyctl logs` 関連行（抜粋）

```text
2026-04-21T07:39:03Z {"service":"agent-server","msg":"File uploaded","filename":"57e83203-e35b-460a-aabe-9eed2ab66bbc.png","size":382}
2026-04-21T07:39:03Z {"service":"agent-server","msg":"WS message received","type":"chat"}
2026-04-21T07:39:03Z {"service":"chat-handler","msg":"OpenCode session created","sessionId":"ses_251058721ffeYDKVyDwTz6U2wD"}
2026-04-21T07:39:03Z {"service":"chat-handler","msg":"promptAsync sent","sessionId":"ses_251058721ffeYDKVyDwTz6U2wD","partCount":2,"hasImage":true}
2026-04-21T07:40:00Z {"service":"agent-server","msg":"Auto-committed","hash":"fde815f","message":"AI edit"}
2026-04-21T07:41:21Z {"service":"agent-server","msg":"WS message received","type":"chat"}
2026-04-21T07:41:21Z {"service":"chat-handler","msg":"promptAsync sent","sessionId":"ses_251058721ffeYDKVyDwTz6U2wD","partCount":1,"hasImage":false}
2026-04-21T07:41:32Z {"service":"agent-server","msg":"OpenCode response completed (stream)","sessionId":"ses_251058721ffeYDKVyDwTz6U2wD"}
2026-04-21T07:41:32Z {"service":"agent-server","msg":"Auto-committed","hash":"3099b95","message":"AI edit"}
```

関連警告（T008 の結論には影響しないが、v40 に残存している背景ノイズ）:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@hono/node-server'
```

`hono` 本体は動作しているが、ゲストサイト側 `functions/` の Hono dev server が起動に失敗している可能性。**A001 の段階ですでに観測されており本タスクの範囲外**だが、別途確認推奨。

---

## 8. 新規発見バグ: `/uploads/*` が本番 agent-server でサーブされていない

### 8.1 症状

- AI が生成した `<img src="/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png" alt="..." />` が、iframe プレビュー内で **画像として読み込めない**
- `screenshot-02-hero-current.png` ではヒーロー背景が真っ暗（`bg-black/30` のオーバーレイのみ）

### 8.2 原因

```bash
$ curl -sI https://ai-web-builder-demo.fly.dev/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png
HTTP/2 200
content-length: 399
content-type: text/html; charset=utf-8      ← SPA fallback で editor index.html が返る

$ curl -sI https://ai-web-builder-demo.fly.dev/preview/uploads/57e83203-e35b-460a-aabe-9eed2ab66bbc.png
HTTP/2 200
content-length: 382
content-type: image/png                     ← Vite dev server 経由なら正しく配信される
```

- `container/agent-server/src/app.ts` を grep した結果:
  - `/api/upload`: `public/uploads/` にファイル保存、レスポンスは `{ url: "/uploads/<filename>" }`
  - `/preview/*`: Vite dev server にプロキシ
  - `/*` (production SPA fallback): エディター `index.html` を返す
  - **`/uploads/*` をサーブ/プロキシするルートは存在しない**
- iframe は `/preview/` 配下で Vite を読み込むため、document origin は `https://ai-web-builder-demo.fly.dev`。iframe 内の `<img src="/uploads/foo.png">` は絶対パス扱いで `https://ai-web-builder-demo.fly.dev/uploads/foo.png` にアクセス → SPA fallback にヒットする

### 8.3 影響範囲

- **本番アップロード機能すべてが表示段階で壊れている**（改修 B/C 適用前から存在していた疑いが濃い）
- T005 ではハングが目立っていたため隠れていたバグ。T006 改修でハングが消えた結果、顕在化した

### 8.4 修正候補（実装はしない）

いずれか一つ:

1. `app.ts` に `app.get("/uploads/*", (c) => proxy(vite, c))` を追加し、Vite dev server 経由で `public/uploads/` を配信
2. `common.md` と `utils.ts#buildPrompt` で AI に教える URL を `/preview/uploads/<uuid>.<ext>` に統一
3. `/api/upload` のレスポンス `url` を `/preview/uploads/<filename>` に変更し、フロントや AI が使う URL を一致させる

ただしどの方針も「ブラウザがプレビュー URL ではなく直接画像 URL を開いたとき」「Cloudflare に deploy された後」の挙動まで整合させる必要があるため、**単純な route 追加では済まない**可能性あり。設計の検討が必要。

---

## 9. 残課題 / 次タスクの提案

cmux-team create-task 用の下書き。**ここでは自分では起票せず、Conductor / Master / ユーザー判断に委ねる。**

### 9.1 T009-A（最優先）: `/uploads/*` ルーティング修正

```markdown
# Task: ai-web-builder-demo で <img src="/uploads/..."> が SPA fallback に落ちる件

## 背景
T008 (task-008-1776756835) の検証中に発見。AI が multimodal 画像アップロードで
`<img src="/uploads/<uuid>.<ext>">` を生成するが、agent-server に該当ルートが無く
SPA fallback で text/html が返るため画像として表示されない。

A001 / T006 改修でハングは解消したが、ユーザー視点では「画像を添付すると
ヒーローが真っ暗になる」状態。

## 修正方針候補
1. agent-server に `/uploads/*` ルートを追加し `public/uploads/` をプロキシ
2. 共通インストラクションと buildPrompt の URL を `/preview/uploads/...` に統一
3. Cloudflare Pages / Workers deploy 先での対応も考える

どれを採用するか設計判断が必要。Architect にレビュー依頼する。

## 参考
- T008 report §8
- container/agent-server/src/app.ts
- container/instructions/common.md
- container/agent-server/src/utils.ts#buildPrompt
```

### 9.2 T009-B（中優先）: 改修 D（180s timeout）の実発火試験

```markdown
# Task: inactivity timeout (180s) の実発火確認

## 背景
T008 では busybox shell の制約で SIGSTOP による stall 再現ができず、
正常ケースの非発火のみ確認した。timeout 側の動作検証が未実施。

## 候補手段
- OpenCode に非常に重い処理を意図的に流すテスト用プロンプト
- 専用のデバッグルートで opencode サーバーを強制スリープ
- `container/agent-server/src/chat-handler.ts#runInactivityTimeout` を
  localhost で走らせるシナリオ E2E テスト

## 完了条件
- WS に `{type: "error", message: "AI の応答が 3 分間..."}` 相当が届くことを確認
- `opencode.session.abort` が実際に叩かれることを確認
```

### 9.3 T009-C（低優先）: `@hono/node-server` 不在警告の調査

```markdown
# Task: ゲストサイトの functions/ Hono dev server 起動失敗の調査

## 背景
v40 の flyctl logs に `ERR_MODULE_NOT_FOUND: @hono/node-server` が残存。
A001 時点からあり T008 の結論には影響しないが、production デプロイ時に
API エンドポイントが動かない可能性。
```

---

## 10. 完了条件チェック

- [x] `T008-report.md` が存在
- [x] 8 セクション（概要 / 再現テスト / 改修 B C D / timeout / 回帰 / スクショ / logs / 残課題）を網羅
- [x] 改修 B/C/D ごとに「動いた」「動かなかった」「判定不能」が明示されている
- [x] 禁止事項（本番 `ai-web-builder` アクセス、追加 deploy、追加改修）を守っている
- [x] 次タスクは下書きのみで、自分では `cmux-team create-task` を叩いていない

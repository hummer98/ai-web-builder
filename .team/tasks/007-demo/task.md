---
id: 007
title: demo アプリに改修をデプロイ
priority: high
depends_on: [006]
created_by: surface:289
created_at: 2026-04-19T14:41:38.488Z
---

## 背景

T006 で実装した画像アップロードハング対応（改修 B/C/D）を main にマージし、ai-web-builder-demo にデプロイする。

前 2 ラン:
- 1 回目: ff-only 不可（main と task-006 が fa342ed で分岐）→ 停止
- 2 回目: rebase 1 commit 目 `e5dbc28` で `container/scaffold/AGENTS.md` conflict → 停止

**conflict の原因:** ローカル main の `9a1f0fc`（T004）で AGENTS.md を「builder-common」(`container/instructions/common.md`) と「ゲスト固有」(`container/scaffold/AGENTS.md`) に分離済み。T006 の `e5dbc28` は旧 AGENTS.md にユーザーアップロード画像ガイダンスを書いていたため、位置が消えて衝突。

**解決方針:** `e5dbc28` を rebase で **drop** し、代わりに `container/instructions/common.md`（builder-common 側）に同等内容を追加する新 commit B' を積む。ユーザーアップロード画像の扱いはすべてのゲストで共通のビルダー挙動なので、common.md が正しい置き場所。

## 前提

- T006 の worktree branch: `task-006-1776610390/task`（現状 `aa6f339` — `fa342ed` の上に 3 commit）
- 3 commit の中身: `e5dbc28` B / `cc3c67e` C / `aa6f339` D
- ローカル main HEAD: `6a6952e`（origin/main `fa342ed` より 2 commit 先行）
- `cc3c67e` (C: multimodal) と `aa6f339` (D: timeout) は `container/agent-server/src/` のみ変更。ローカル main 追加 2 commit (T004/T005) が触った該当ファイルと重複なし → **追加の conflict は想定されない**
- T006 Inspector 判定: GO

## ⚠️ 重要: main に push しない

`.github/workflows/deploy.yml` は main push で `ai-web-builder`（le-serpent 本番）に自動デプロイする。
よって **`git push origin main` は禁止**。merge はローカルのみ、deploy は `flyctl deploy -c fly.demo.toml` のローカル Docker build で行う。

## 手順

### 1. 状態確認

```bash
cd /Users/yamamoto/git/ai-web-builder
git fetch origin main
git log --oneline -5 main                               # 6a6952e が HEAD
git log --oneline -5 task-006-1776610390/task           # aa6f339 が HEAD
git merge-base main task-006-1776610390/task            # fa342ed
```

### 2. rebase で e5dbc28 を drop

task-006 branch は `.worktrees/task-006-1776610390/` で checkout 済みなので、そこで rebase:

```bash
cd /Users/yamamoto/git/ai-web-builder/.worktrees/task-006-1776610390

# --onto main e5dbc28 HEAD で「e5dbc28..HEAD」(= cc3c67e, aa6f339 の 2 件) を main の上に乗せ直す。
# e5dbc28 自体は含まれないので drop される
git rebase --onto main e5dbc28 task-006-1776610390/task
```

- conflict が起きたら `git rebase --abort` → Master に報告（cc3c67e / aa6f339 で conflict が出るのは想定外）
- rebase 完了後、`git log --oneline` で以下のようになるはず（SHA は新規）:
  ```
  <new-sha-D> feat(agent-server): abort prompt after 180s of SSE inactivity
  <new-sha-C> feat(agent-server): send uploaded images as multimodal file part to OpenCode
  6a6952e     docs: T005 demo 画像アップロード 4 分ハングの調査レポート
  9a1f0fc     feat: separate builder-common instructions from guest-specific AGENTS.md
  fa342ed     ci: add GitHub Actions workflow for Fly.io production deploy
  ```

### 3. 新 commit B' を追加（common.md に画像 upload セクション）

`container/instructions/common.md` の「画像生成（nano-banana MCP）」セクション（L46 付近）の **直前** に、以下の新セクションを追加する:

```markdown
## ユーザーがアップロードした画像

ユーザーがチャット UI で画像を添付した場合、その画像は multimodal で OpenCode に直接渡されている。モデルはファイルを「見える」状態なので、`read` ツールで内容を読む必要はない（バイナリを `read` すると応答が詰まる原因になる）。

- 保存先: `public/uploads/<uuid>.<ext>`
- 参照方法: `<img src="/uploads/<uuid>.<ext>" alt="説明" />`
- `alt` は日本語で文脈に沿った説明を付ける
- nano-banana で生成した画像（`public/images/`）とは保存先が異なるので、`src` を間違えない

ユーザーは「この画像をヒーローにして」等のペルソナで指示する。指示された場所に上記の `<img>` で配置すればよい。
```

その後、commit:

```bash
cd /Users/yamamoto/git/ai-web-builder/.worktrees/task-006-1776610390
git add container/instructions/common.md
git commit -m "docs(common): builder-common にユーザーアップロード画像の扱いを追加"
```

**補足:** この新 commit は T006 で用意したテスト（`instructions-common.test.ts` 等）が期待する形式と矛盾しないように書く。新セクションのヘッダー文字列が `instructions-common.test.ts` のアサーションに含まれていないか確認し、テスト側で補強が必要なら該当テストを 1-2 件追加する（そうでなければテスト変更不要）。

### 4. メインワークツリーで ff-only merge

```bash
cd /Users/yamamoto/git/ai-web-builder
git checkout main
git merge --ff-only task-006-1776610390/task
git log --oneline -6 main    # B' / D / C / 6a6952e / 9a1f0fc / fa342ed
```

ff-only で失敗したら `git merge --abort` → Master に報告。

### 5. テスト再実行

```bash
cd /Users/yamamoto/git/ai-web-builder
npm test
npm audit --audit-level=high
```

- vitest: 全テスト通過。新セクションを追加したために `instructions-common` 系テストで失敗が出たら、テスト側を合理的に修正（新ヘッダーを期待値に追加する等）して再実行
- audit: HIGH 0 件を確認

### 6. demo にデプロイ（ローカル Docker build）

```bash
flyctl deploy -c fly.demo.toml
```

`-c fly.demo.toml` でアプリ名が `ai-web-builder-demo` になることを確認してから実行。

### 7. 完了確認

```bash
flyctl releases -a ai-web-builder-demo | head -5
flyctl status -a ai-web-builder-demo
flyctl logs -a ai-web-builder-demo     # 数十秒 tail
```

起動ログで agent-server / opencode / vite / hono の 4 プロセスが正常起動し致命的エラーがないことを確認。

## 成果物

`.team/output/T007-report.md`:
- rebase 後の HEAD SHA（新 C / D の SHA、drop した e5dbc28 の扱い）
- 新 commit B' の SHA と変更差分（common.md の diff）
- merge 後の main HEAD SHA
- `npm test` の結果
- `npm audit` の HIGH 件数
- デプロイしたイメージ ID / リリースバージョン
- マシン状態（started）
- 起動ログ抜粋

## 禁止事項

- `ai-web-builder`（le-serpent 本番）への一切の変更・deploy・secret 操作
- `fly.toml`（ai-web-builder 用）の編集
- **`git push origin main`**（main push = 本番自動デプロイ）
- `git push` 系コマンド全般
- rebase / merge で想定外の conflict が起きた場合の自律解決（必ず Master に上げる）
- `container/scaffold/AGENTS.md` への追記（T004 の分離方針に反する — ここには書かない）
- 動作不良時に本番切り戻しを試みる（T008 未実施段階で本番に触らない）

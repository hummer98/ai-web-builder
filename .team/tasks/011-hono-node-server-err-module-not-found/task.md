---
id: 011
title: @hono/node-server ERR_MODULE_NOT_FOUND 警告の調査
priority: medium
created_by: surface:529
created_at: 2026-04-21T08:52:22.798Z
---

## タスク
## 背景

T005 (`.team/artifacts/A001-research.md`) および T008 (`.team/artifacts/A002-T008-report.md` §7) の両方で `flyctl logs -a ai-web-builder-demo` に以下の警告が観測されている:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@hono/node-server'
```

\`hono\` 本体は動作しているが、**ゲストサイト側の \`functions/\` Hono dev server が起動失敗している可能性**。本番 Cloudflare Pages デプロイ後のゲストサイト API が動かないリスクがある。

## 調査スコープ

1. エラーを出しているのはどのプロセスか特定
   - 候補: ゲストサイト \`functions/\` の Hono dev server（port 3000, tsx watch）
   - \`container/start.sh\` でどう起動されているか確認
2. \`@hono/node-server\` はどこに必要か確認
   - ゲストサイトの \`package.json\`（\`container/scaffold/\` 配下 or 実際にマウントされたゲストリポジトリ）
   - 依存が宣言されているか、インストールされているか
3. 本番 Cloudflare Pages / Workers デプロイ時に同じ問題が発生するかの切り分け
   - Workers 環境では \`@hono/node-server\` 不要のはずだが、開発時 (Fly.io コンテナ内の tsx watch) のみ必要
4. ゲストサイト API が **実際に動いているか** を確認
   - demo 上で \`/api/<ゲストサイトの任意のエンドポイント>\` を叩いて 200 が返るか
   - iframe プレビューから API コールが成立しているか

## 完了条件

以下のいずれかが明確になる:

- [ ] 警告の根本原因が特定され、**実害がない** ことが判明（例: 起動フェーズで一時的に出るが後続で解決）→ その証拠と共に「対応不要」の結論
- [ ] 実害があることが判明（API が動いていない等）→ 修正方針を提示し、**別タスクとして起票の下書き**を残す（このタスク内では修正実装しない）

## 成果物

\`.team/artifacts/\` に調査レポート（A00X-hono-node-server-investigation.md 相当）:
- エラーが出ているプロセスと起動コマンド
- \`@hono/node-server\` の依存宣言とインストール状況
- ゲストサイト API の実動作確認結果（curl or ブラウザ）
- 結論と次タスクの下書き（必要な場合）

## 参考

- レポート: \`.team/artifacts/A001-research.md\`（T005 調査）、\`.team/artifacts/A002-T008-report.md\` §7
- 起動スクリプト: \`container/start.sh\`
- CLAUDE.md の「コンテナ内プロセス」セクション
- scaffold 一式: \`container/scaffold/\`

## 禁止事項

- 本番 \`ai-web-builder\` への deploy / 変更
- このタスク内での実装修正（調査 + レポートのみ。修正は別タスクで）

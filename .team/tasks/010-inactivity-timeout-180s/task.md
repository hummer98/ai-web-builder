---
id: 010
title: inactivity timeout 180s の実発火試験
priority: medium
created_by: surface:529
created_at: 2026-04-21T08:51:59.731Z
---

## タスク
## 背景

T008 (`.team/artifacts/A002-T008-report.md` §3.3, §9.2) で busybox shell に `ps` / `kill` の拡張フラグがなく SIGSTOP による stall 再現ができず、改修 D（180s SSE 無応答 abort + WS timeout メッセージ）の **実発火試験が未実施**。

現状の確認済み範囲:

- 単体テスト `container/agent-server/src/timeout.test.ts` で fake timer による発火確認済み
- 正常ケース (57s / 11s 完了) で `session.status=idle` → `timer.stop()` → onTimeout 非発火を確認済み

未確認: 本物の agent-server + OpenCode 統合環境で、無応答継続時に abort と WS エラーメッセージが実際に届くかどうか。

## 方針候補

### 候補 A（推奨）: デバッグフック付きローカル E2E

- ローカルで agent-server を起動しながら、OpenCode クライアントを **mock または stub**（promptAsync を呼んだあと SSE を一切流さず sleep する偽実装）に差し替える
- WS クライアント（または Playwright）から chat リクエストを送り、タイムアウトまで待機して以下を確認:
  - WS に \`{type: "error", message: "AI の応答が 3 分間..."}\` 相当が届く
  - \`opencode.session.abort\` 相当が呼ばれた（mock 側で観測）
- タイムアウト閾値はテスト用に \`INACTIVITY_TIMEOUT_MS\` を env 等で縮められるようにしてよい（本番値 180s のまま 3 分待つのは遅すぎるので）

### 候補 B: デバッグルート
- \`/api/debug/stall-next\` のような本番デプロイ時は無効のエンドポイントを用意し、次の chat リクエストで SSE を強制的に止める
- CI/本番では \`DEBUG=0\` で無効化

### 候補 C: 統合テスト
- \`app.test.ts\` 相当に WebSocket 接続 + mock OpenCode サーバーの統合テストを追加し、fake timer で検証

## 完了条件

- 上記いずれかの方針で、**実 WS コネクションから timeout エラーメッセージが受信できる** ことを確認
- 同時に \`session.abort\` 相当の呼び出しが観測できる
- テストコードとして再現可能な形にする（将来のリグレッション防止）
- 本番 demo にデプロイしての確認は不要（コスト効率が悪いため）。ローカル or CI でのみ検証する

## 参考

- レポート: \`.team/artifacts/A002-T008-report.md\` §3.3, §4, §9.2
- コード:
  - \`container/agent-server/src/timeout.ts\` (\`reset()\` / \`stop()\` / \`onTimeout\`)
  - \`container/agent-server/src/chat-handler.ts#runInactivityTimeout\`
  - \`container/agent-server/src/index.ts\` (\`INACTIVITY_TIMEOUT_MS = 180_000\`)
  - \`container/agent-server/src/timeout.test.ts\` (既存の fake timer テスト)

## 禁止事項

- 本番 \`ai-web-builder\` / demo \`ai-web-builder-demo\` への deploy での試験は行わない（遅い・コストを消費する）

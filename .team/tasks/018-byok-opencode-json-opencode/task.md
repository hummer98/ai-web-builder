---
id: 018
title: BYOK: opencode.json 実値書き換え + opencode 再起動メカニクス
priority: high
depends_on: [016]
created_by: surface:274
created_at: 2026-05-05T09:07:36.547Z
---

## タスク
# 目的

BYOK のキー（OPENROUTER, GEMINI）を opencode が起動時に読む \`opencode.json\` に**実値で**埋め込み、キー更新時に opencode プロセスを安全に再起動する仕組みを実装する。

# 背景

- 現状の opencode.json は \`\"apiKey\": \"{env:OPENROUTER_API_KEY}\"\` で env 参照
- BYOK 必須に切り替えるため、env ではなく secretsStore から取得した実値を埋め込む
- nano-banana MCP の GEMINI_API_KEY も同様に secretsStore 経由
- ユーザーがキーを更新したら opencode プロセスを再起動して反映する

# 前提

- T016 で実装される \`secrets-store.ts\` を使う
- 既存ファイル: \`container/opencode-postprocess.mjs\`, \`container/agent-server/src/site-init.ts\`, \`container/start.sh\`

# 仕様

## opencode-postprocess.mjs の改修
- 現状: \`{env:OPENROUTER_API_KEY}\` 文字列のままで opencode が解決
- 変更後: secretsStore から OPENROUTER の apiKey を取得し、\`opencode.json\` の \`provider.openrouter.options.apiKey\` に**実値**を書き込む
- secretsStore に未登録の場合は \`apiKey\` フィールドを**書かない**（opencode が起動エラーで気づける状態にする）または特殊な placeholder（要 OpenCode の挙動確認、起動時エラーメッセージで非エンジニアに分かりにくくないか確認）
- nano-banana MCP の \`environment.GEMINI_API_KEY\` も secretsStore から（既に \`--nano-banana-key\` 引数で受け取っている部分を内部で secretsStore 参照に変更）
- 既存の \`--nano-banana-key=\` 引数は後方互換のため残してよいが、secretsStore 優先

## start.sh の改修
- 現状: \`--nano-banana-key=\${GEMINI_API_KEY:-}\` を渡している
- 変更後: 環境変数経由をやめ、postprocess が secretsStore を直接読む形に
- ただし local dev で \`SECRETS_FILE\` を渡す環境変数の扱いは整理（postprocess プロセスにも同じ \`SECRETS_FILE\` が見える状態にする）

## opencode 再起動メカニクス
新規ファイル: \`container/agent-server/src/opencode-supervisor.ts\`

\`\`\`ts
export async function restartOpencode(): Promise<void>
\`\`\`

- 流れ:
  1. \`opencode-postprocess.mjs\` を再実行して opencode.json を最新化
  2. 既存の opencode プロセスを停止（\`pkill -f 'opencode serve'\` または PID 管理）
  3. 同じコマンドで再 spawn（start.sh と整合）
  4. \`/health\` 相当のエンドポイント or ポート 4096 への接続成功を待つ（タイムアウト 10s）
  5. 失敗時はエラーをスロー

- **どこから呼ぶか**: T017 の PUT /api/secrets が openrouter / gemini を更新したら呼ぶ
- WebSocket 経由でフロントに \`{ system: 'opencode_restarting' }\` / \`{ system: 'opencode_ready' }\` を通知（既存の WS メッセージ規約に合わせる、ws-handler.ts 参照）

## 既存テストの更新
- \`opencode-postprocess.test.ts\` / \`site-init.test.ts\` で env 参照前提だったケースを secretsStore 前提に書き換え
- 新規テスト:
  - secretsStore 未設定時の opencode.json 出力
  - secretsStore 設定済みでの opencode.json 出力（apiKey が実値で埋まる）

# 注意点

- **キーがログに出ないこと**を必ずテストで確認
- start.sh で opencode プロセスの spawn コマンドを supervisor.ts と一致させる（DRY のためサブモジュール化を検討）
- 再起動中に来たユーザーリクエストの扱いは agent-server 側で「再起動中」エラーを返す

# 完了条件

- [ ] opencode-postprocess.mjs 改修 + テスト更新
- [ ] opencode-supervisor.ts 実装 + テスト
- [ ] start.sh 改修
- [ ] T017 から呼ぶフック（restartOpencode）の export
- [ ] WS 通知メッセージ追加
- [ ] \`npm test\` 通過

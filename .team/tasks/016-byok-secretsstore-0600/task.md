---
id: 016
title: BYOK: secretsStore 実装（読み書き + 0600 + テスト）
priority: high
created_by: surface:274
created_at: 2026-05-05T09:06:48.703Z
---

## タスク
# 目的

BYOK 機能の基盤として、API キー類を Fly Volume の専用ファイルに永続化する secretsStore モジュールを実装する。後続タスク（Hono ルート、opencode.json 書き換え、deploy）が全てこのモジュールを使う。

# 背景

- 友人向け個人ツール。商用展開なし（CLAUDE.md 参照）
- 現状はキー類を `.envrc` / Fly Secrets で管理しているが、BYOK 化して editor から登録できるようにする
- 全体設計はユーザー Master と合意済み（このタスクは段階1）

# 仕様

## 保存先
- 本番（コンテナ内）: \`/data/secrets.json\`（Fly Volume にマウント済み）
- ローカル開発: 環境変数 \`SECRETS_FILE\` で上書き可。デフォルトは repo 直下 \`data/secrets.json\`（**.gitignore に追加すること**）

## ファイル形式
\`\`\`json
{
  "openrouter": { "apiKey": "sk-or-..." },
  "gemini":     { "apiKey": "..." },
  "cloudflare": { "apiToken": "...", "accountId": "..." },
  "firebase":   { "token": "..." }
}
\`\`\`
- 全プロバイダ optional（未設定 = キーなし）
- 不要なフィールドは保存しない（空文字列も保存しない）

## モジュール API
配置: \`container/agent-server/src/secrets-store.ts\`

\`\`\`ts
export interface Secrets {
  openrouter?: { apiKey: string };
  gemini?: { apiKey: string };
  cloudflare?: { apiToken: string; accountId: string };
  firebase?: { token: string };
}

export interface SecretStatus {
  openrouter: { set: boolean; last4?: string };
  gemini: { set: boolean; last4?: string };
  cloudflare: { set: boolean; last4?: string; accountId?: string };
  firebase: { set: boolean; last4?: string };
}

export function loadSecrets(): Secrets;          // ファイル無しなら {} を返す
export function saveSecrets(s: Secrets): void;   // atomic write + chmod 0600
export function getStatus(): SecretStatus;       // last4 だけ返す（本体は返さない）
export function updateProvider<K extends keyof Secrets>(
  provider: K, value: Secrets[K] | null
): void;                                          // null で削除
\`\`\`

## 実装要件
- **atomic write**: 一時ファイル \`secrets.json.tmp\` に書いて \`rename()\` で置き換え
- **パーミッション**: 書き込み後に \`chmod 0600\`（root のみ読み書き）
- **ログ禁止**: キー本体・last4 以外を絶対にログ出力しない（CLAUDE.md セキュリティガイドライン）
- **存在しないファイル**: \`loadSecrets()\` は空オブジェクトを返す（エラーにしない）
- **壊れた JSON**: 起動時はエラーにせず、warn ログ + 空オブジェクトで継続（破損時に画面が動かなくなるのを避ける）

# テスト

\`container/agent-server/src/secrets-store.test.ts\`

- temp dir で実物テスト（vitest, テンポラリ secrets ファイル）
- ケース:
  1. ファイル無し → loadSecrets が {} を返す
  2. saveSecrets → loadSecrets で同じ値が読める
  3. saveSecrets 後にファイルパーミッションが 0600
  4. updateProvider('openrouter', null) で削除される
  5. getStatus は last4 のみで本体を返さない
  6. 壊れた JSON ファイルでも loadSecrets が落ちない
  7. atomic: 書き込み中の中断でも既存ファイルが破壊されない（rename ベースで担保）

# 完了条件

- [ ] \`container/agent-server/src/secrets-store.ts\` 実装
- [ ] 同 \`*.test.ts\` でカバレッジ
- [ ] \`npm test\` 全体が通る
- [ ] \`.gitignore\` に \`data/secrets.json\` を追加

# 後続タスク

- Hono \`/api/secrets\` ルート（このタスク完了後）
- opencode.json 実値書き換え + 再起動
- deploy.ts env 上書き

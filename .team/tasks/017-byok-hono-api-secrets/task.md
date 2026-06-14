---
id: 017
title: BYOK: Hono /api/secrets ルート実装
priority: high
depends_on: [016]
created_by: surface:274
created_at: 2026-05-05T09:07:12.842Z
---

## タスク
# 目的

editor からキーを登録・確認・削除する HTTP API を agent-server に追加する。

# 前提

- T016 で実装される \`secrets-store.ts\` を使う
- agent-server は既に Hono ベース。\`container/agent-server/src/\` 配下に追加
- 認証は既存の認証ガード下に置く（本番は Cloudflare Access / Basic auth、CLAUDE.md「本番認証 (Fly.io)」参照）

# 仕様

## エンドポイント

### \`GET /api/secrets\`
- レスポンス: \`SecretStatus\`（last4 のみ。本体は絶対に返さない）
- 例:
  \`\`\`json
  {
    \"openrouter\": { \"set\": true, \"last4\": \"a1b2\" },
    \"gemini\": { \"set\": false },
    \"cloudflare\": { \"set\": true, \"last4\": \"x9y8\", \"accountId\": \"abc123\" },
    \"firebase\": { \"set\": false }
  }
  \`\`\`

### \`PUT /api/secrets\`
- リクエスト body: 部分更新可な Secrets。Zod でバリデーション
  \`\`\`ts
  const SecretsUpdateSchema = z.object({
    openrouter: z.object({ apiKey: z.string().min(1) }).optional(),
    gemini: z.object({ apiKey: z.string().min(1) }).optional(),
    cloudflare: z.object({
      apiToken: z.string().min(1),
      accountId: z.string().min(1),
    }).optional(),
    firebase: z.object({ token: z.string().min(1) }).optional(),
  });
  \`\`\`
- 既存の他プロバイダ設定は維持（merge update）
- レスポンス: 更新後の SecretStatus
- **副作用**: openrouter / gemini が変更された場合、後続タスク T018 で実装する opencode 再起動フックを呼ぶ（このタスクでは I/F だけ用意。T018 で実装される再起動関数を import して呼ぶ形にする。T018 が未実装の段階では no-op でよい）

### \`DELETE /api/secrets/:provider\`
- \`provider\` は \`openrouter\` | \`gemini\` | \`cloudflare\` | \`firebase\`
- そのプロバイダのエントリを削除
- レスポンス: 更新後の SecretStatus

## バリデーションエラー
- Zod 失敗時は 400 + \`{ error: 'invalid_request' }\`（詳細はログのみ。レスポンスにスタックを含めない）

## ログ
- キー本体・last4 を含めない
- \`{ event: 'secrets_updated', providers: ['openrouter'] }\` のような形でプロバイダ名のみログ

# テスト

\`container/agent-server/src/api-secrets.test.ts\`

- Hono の testClient でリクエスト/レスポンス検証
- temp dir に secrets ファイルを置く（SECRETS_FILE 環境変数）
- ケース:
  1. GET 初期状態は全 false
  2. PUT で openrouter 設定 → GET で set:true, last4 表示
  3. PUT で部分更新（gemini だけ）→ openrouter は維持
  4. DELETE → set:false に戻る
  5. 不正な body（apiKey 空）で 400
  6. レスポンスにキー本体が含まれないこと（snapshot で last4 のみ）

# 完了条件

- [ ] \`container/agent-server/src/api-secrets.ts\` 実装
- [ ] 既存の Hono ルーターに登録（既存ルーターの場所は要調査）
- [ ] 同 \`*.test.ts\`
- [ ] \`npm test\` 通過

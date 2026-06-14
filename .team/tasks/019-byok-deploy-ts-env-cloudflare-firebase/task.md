---
id: 019
title: BYOK: deploy.ts の env 上書き対応（Cloudflare/Firebase）
priority: medium
depends_on: [016]
created_by: surface:274
created_at: 2026-05-05T09:07:47.812Z
---

## タスク
# 目的

\`POST /api/deploy\` 系の処理で wrangler / firebase CLI を spawn する際、secretsStore に登録された Cloudflare / Firebase のトークンを使うよう改修する。

# 背景

- 現状: \`process.env.CLOUDFLARE_API_TOKEN\` 等を直接参照（Fly Secrets 由来）
- BYOK 必須化により、これらは secretsStore から取得する
- 既存ファイル: \`container/agent-server/src/deploy.ts\`

# 仕様

## 変更内容

### Cloudflare（wrangler）
- spawn 時の env を上書き:
  \`\`\`ts
  const cf = loadSecrets().cloudflare;
  if (!cf) throw new Error('cloudflare_secrets_not_configured');
  spawn('npx', ['wrangler', 'deploy', ...], {
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: cf.apiToken,
      CLOUDFLARE_ACCOUNT_ID: cf.accountId,
    },
  });
  \`\`\`

### Firebase
- 同様に \`FIREBASE_TOKEN\` を secretsStore から
- 既存の deploy.ts の Firebase 分岐を改修

## ガード
- BYOK 必須なので、未設定時は明示エラー:
  - 未設定プロバイダで deploy しようとしたら 400 で \`{ error: 'cloudflare_secrets_not_configured' | 'firebase_secrets_not_configured' }\`
- WS 経由の deploy リクエストでも同じガード

## ログ
- キー本体・last4 をログに出さない
- 失敗ログは「どのプロバイダが未設定か」のみ

# テスト

\`container/agent-server/src/deploy.test.ts\` の更新 or 追加

- secretsStore モックで Cloudflare 設定済み → spawn 引数の env に CLOUDFLARE_API_TOKEN が乗る
- secretsStore モックで未設定 → 400 / エラー
- Firebase 同様

# 完了条件

- [ ] deploy.ts 改修
- [ ] テスト追加・更新
- [ ] \`npm test\` 通過

---
id: 003
title: GitHub Actions で Fly.io 本番への自動デプロイを設定
priority: medium
created_by: surface:280
created_at: 2026-04-19T13:52:04.092Z
---

## タスク
## 背景

現状 `.github/workflows/` が存在せず、`flyctl deploy` は手動実行。
T001, T002 の変更も main マージ済みだが本番未反映。Fly.io 本番への自動デプロイを整備する。

## 方針（確定済み）

- 対象アプリ: **`ai-web-builder`（本番）のみ**。`ai-web-builder-demo` は対象外
- トリガー: **main push + workflow_dispatch**
- デプロイ前に **`npm test` を必ず通す**（失敗したらデプロイしない）
- シークレット: GitHub Actions secrets の `FLY_API_TOKEN` を使用（登録はユーザーが `gh secret set` で行う想定）

## 成果物

### `.github/workflows/deploy.yml`

以下の仕様で新規作成:

\`\`\`yaml
name: Deploy to Fly.io

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --config fly.toml --app ai-web-builder
        env:
          FLY_API_TOKEN: \${{ secrets.FLY_API_TOKEN }}
\`\`\`

### 調整ポイント（実装時に確認）

- **Node バージョン**: ルート `package.json` の `engines` or `.nvmrc` があればそれに合わせる。なければ 22 LTS
- **`npm ci` がモノレポ構造に対応しているか**: editor/, container/agent-server/, container/log-reader-mcp/ が個別 `package.json` を持っている可能性あり。ルートに workspaces 設定があるか確認。個別に `npm ci` / `npm test` が必要ならマトリクスか複数ステップに分ける
- **`npm test` の挙動**: ルートで全パッケージのテストが走るか確認。ダメなら個別パッケージで実行
- **`concurrency` でデプロイの重なりを防止**: main への連続 push で複数ワークフローが同時に走るのを防ぐ

## 確認観点

- [ ] workflow ファイルの YAML 構文が正しい（`gh workflow view deploy.yml` または actions タブで確認）
- [ ] `npm test` がワークフロー内で通る（ローカルと同等の結果）
- [ ] `flyctl deploy` が `fly.toml` を正しく解釈する
- [ ] デプロイ後、`https://editor.le-serpent.club` が応答する

## 非対象（今回やらない）

- `ai-web-builder-demo` への自動デプロイ
- PR プレビュー環境
- Cloudflare Pages / Workers / D1 のデプロイ（別途必要なら別タスク）
- デプロイ失敗時の Slack/Discord 通知
- ロールバック機構

## ユーザー側で必要な作業（タスク完了後）

1. Fly.io デプロイトークン発行:
   \`\`\`
   fly tokens create deploy -a ai-web-builder -x 999999h
   \`\`\`
2. GitHub Secrets に登録:
   \`\`\`
   gh secret set FLY_API_TOKEN --repo hummer98/ai-web-builder
   \`\`\`
   （プロンプトで上記トークンをペースト）

この 2 ステップは Agent ではなく Master / ユーザーが実施する。タスク本体（workflow ファイル作成）はシークレット登録なしで進められる。

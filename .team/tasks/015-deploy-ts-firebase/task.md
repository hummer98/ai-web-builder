---
id: 015
title: deploy: Firebase 対応の残作業（functions install / docs / 実機確認）
priority: high
created_by: surface:104
created_at: 2026-05-03T14:19:09.201Z
---

## 概要

`deploy.ts` の Firebase 対応の **残作業** を仕上げる。実装本体（判別ロジック・両経路の deploy・vitest テスト・Dockerfile への firebase-tools 追加・CLAUDE.md 反映）は既にローカルにコミット済みの前提。本タスクではバグ修正とドキュメント整備、動作確認に絞る。

## 現状（main にコミット済みの想定）

- `detectProvider(workspaceDir)` で `firebase.json` / `wrangler.toml` から判別
- Firebase 経路: `vite build` → `npx firebase deploy --non-interactive`、`FIREBASE_TOKEN` を env 経由で渡す（CLI 引数には乗せない）
- Cloudflare 経路は既存の挙動を維持し、`pagesUrl` フィールドを `url` に改名（ws-actions も連動修正済み）
- `Dockerfile` に `firebase-tools` グローバルインストールを追加
- vitest で detectProvider / 両経路 / 認証情報未設定 / 設定ファイル不在・両方あり をカバー
- CLAUDE.md の §技術スタック・§シークレットに Firebase 対応を追記済み

## 受け入れ条件

1. **functions deps の事前インストール（重要バグ修正）**
   - `firebase.json` に `functions` 定義があり、かつ `<workspace>/functions/package.json` が存在する場合、`firebase deploy` 実行前に `npm install --prefix functions` を回す
   - `firebase.json` の `functions` が単一 codebase / 複数 codebases どちらの形式でも対応する（`functions` が object か array かで分岐）
   - le-serpent の `functions/package.json`（`firebase-admin`, `firebase-functions`, `@google-cloud/vertexai`, `@google-cloud/bigquery` 等）が deploy 前に解決される状態にする
   - 単体テスト: テンポラリ workspace に `firebase.json` + `functions/package.json` を配置し、`execFileSync` モックの引数列に `npm install --prefix functions` が含まれることを検証

2. **`.envrc.example` への追記**
   - `# Firebase (デプロイ)` セクションを追加し `FIREBASE_TOKEN=` を空欄で記載

3. **ドキュメント更新**
   - `docs/architecture.md`
     - §2.1 技術スタック表の「本番ホスティング」行を Cloudflare / Firebase 併記に更新
     - §デプロイ構成（line 107-113 周辺）に Firebase 経路を追記
     - `le-serpent.club` が Firebase Hosting + Firebase Functions（asia-northeast1）であることを構成図に反映
   - `docs/architecture-diagram.html` を `architecture.md` と整合させる
   - シークレットや Fly Secrets への `FIREBASE_TOKEN` 投入手順は CLAUDE.md §シークレットに既に記載済みの想定。差分があれば軽微に補足する程度に留める

4. **実機動作確認**
   - le-serpent ワークスペースをコンテナ内に整え、`firebase hosting:channel:deploy <preview>` 相当を経由して preview チャンネルに公開
     - もしくは Master の指示があれば本番 (https://le-serpent.club) を直接更新
   - `executeDeploy` 経由（WebSocket `deploy` アクション）で実行し、レスポンスに `url` が返ることを確認
   - 失敗時の error フィールドが友人に分かりやすい日本語であることも確認

5. **テスト全体**
   - `npm test` が全て通ること
   - Cloudflare 既存経路の引数列テストがデグレしていないこと

## 調査依頼（Agent への指示）

- Firebase CLI の `firebase deploy --non-interactive` で `FIREBASE_TOKEN` env が現状の Firebase CLI 最新版でも有効か Context7 (`/firebase/firebase-tools`) で確認。deprecation warning が出ているなら CLAUDE.md にメモを残す
- `firebase.json` の `functions` キーが配列（複数 codebase）の場合の振る舞いを再確認し、必要なら順次 `npm install --prefix <source>` を全 codebase に対して実行する
- `firebase deploy` で `--project default` を明示すべきか、`.firebaserc` 自動解決に任せるか（le-serpent には `.firebaserc` あり）。挙動を確認して必要なら `--project` を付ける

## スコープ外

- 新規サイトを Firebase 用に scaffold する機能
- DNS / カスタムドメインの自動設定
- Firebase Auth / Firestore など他 Firebase サービスへの拡張

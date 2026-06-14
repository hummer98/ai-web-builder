---
id: 022
title: BYOK: docs/CLAUDE.md 同期 + Fly Secrets 整理
priority: medium
depends_on: [021]
created_by: surface:274
created_at: 2026-05-05T09:08:48.595Z
---

## タスク
# 目的

BYOK 化に伴うドキュメント整合性の確保。CLAUDE.md / README / docs/ の記述を実装と一致させる。

# 背景

- これまで CLAUDE.md は Fly Secrets / .envrc 前提で記述
- BYOK 必須化で OPENROUTER_API_KEY / GEMINI_API_KEY / CLOUDFLARE_* / FIREBASE_TOKEN は editor 経由に変わる
- GitHub App / GH_TOKEN は BYOK 対象外（システム側のまま）

# 作業

## CLAUDE.md
- 「シークレット」セクションを更新:
  - BYOK 対象（OpenRouter / Gemini / Cloudflare / Firebase）は editor の設定画面から登録する旨明記
  - \`/data/secrets.json\` に保存される旨
  - GitHub App は引き続き Fly Secrets / .envrc
- 「本番認証 (Fly.io)」は変更なし（既存の Cloudflare Access / Basic auth）

## README.md / README.ja.md
- セットアップ手順から OPENROUTER_API_KEY / GEMINI_API_KEY 等の env 設定を削除
- 「初回起動後、設定画面から各種アクセスキーを登録してください」に置き換え
- スクリーンショット差し替えは不要（必要なら別タスク）

## docs/
- 既存の docs/spec/ 系ドキュメントを cmux-team:dockeeper に倣って同期
- 該当があれば更新、無ければスキップ

## Fly Secrets の取り扱い
- **削除はしない**（既存運用への影響を最小化）
- ただし運用ノートとして「これらの Fly Secrets は廃止予定で参照されていない」旨を CLAUDE.md に注記

## .envrc
- リポジトリ内のサンプル \`.envrc.example\` があれば BYOK 対象キーを除去
- 実 \`.envrc\` は触らない（gitignore 済み・ユーザーローカル）

# 完了条件

- [ ] CLAUDE.md 更新
- [ ] README 更新（日本語・英語両方）
- [ ] docs/ で関連箇所更新
- [ ] テストは特になし（ドキュメントのみ）

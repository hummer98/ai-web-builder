---
id: 020
title: BYOK: editor 設定画面 UI（歯車・モーダル・フォーム）
priority: high
depends_on: [017]
created_by: surface:274
created_at: 2026-05-05T09:08:13.337Z
---

## タスク
# 目的

editor のヘッダーから API キーを登録・確認・削除できる設定画面（モーダル）を実装する。

# 背景

- ユーザーは非エンジニアの友人（CLAUDE.md ペルソナ参照）。専門用語を最小限にする
- 既存 editor: \`editor/src/\` 配下（React + Tailwind）
- バックエンド: T017 の \`/api/secrets\` を使う

# 仕様

## エントリポイント
- ヘッダー or 適切な場所に「設定」ボタン（歯車アイコン）
- クリックで \`<SettingsDialog />\` がモーダル表示

## モーダル構成

### 言葉づかい（非エンジニア向け）
- 「APIキー」ではなく「アクセスキー」と呼ぶ。各プロバイダ名はそのまま（OpenRouter, Gemini, Cloudflare, Firebase）
- 各セクションに「これは何？」のヘルプリンク（ツールチップでも可）。短い説明文と取得 URL リンク
  - OpenRouter: 「サイトを作る AI を動かすキー」 https://openrouter.ai/keys
  - Gemini: 「画像を作るキー（任意）」 https://aistudio.google.com/app/apikey
  - Cloudflare: 「公開先（Cloudflare）に出すためのキー」 https://dash.cloudflare.com/profile/api-tokens
  - Firebase: 「公開先（Firebase）に出すためのキー」（取得手順を別ヘルプで）

### プロバイダごとのカード
- 状態表示: 「未登録」/ 「登録済み（末尾4桁: xxxx）」
- 「変更」ボタン → 入力フォーム展開
- 入力フィールドは type=password、保存ボタン
- 「削除」ボタン（登録済み時のみ。確認ダイアログあり）

### Cloudflare は2フィールド
- API Token + Account ID

## 通信
- 起動時 + モーダルオープン時に \`GET /api/secrets\` で状態取得
- 「保存」で \`PUT /api/secrets\` に該当プロバイダのみ送信
- 「削除」で \`DELETE /api/secrets/:provider\`

## 状態フィードバック
- 保存中スピナー
- OpenRouter / Gemini 保存後は「AI を再起動しています…」表示（数秒）
  - WebSocket の \`opencode_restarting\` / \`opencode_ready\` メッセージで切り替え
- 失敗時はトースト or インライン表示

## アクセシビリティ
- Esc でモーダル閉じる
- 入力中は誤って閉じない（変更未保存時に確認）

# テスト

- 既存テスト規約に合わせる（vitest + 必要なら React Testing Library）
- 単体: フォームの入力 → API モック呼び出しの引数検証
- ステータス表示の分岐（未登録 / 登録済み / エラー）

# 完了条件

- [ ] \`editor/src/components/SettingsDialog.tsx\` 実装
- [ ] ヘッダーに歯車ボタン追加
- [ ] フックや API クライアント整理（\`editor/src/hooks/useSecrets.ts\` 等、既存パターンに合わせる）
- [ ] スタイル（Tailwind）
- [ ] テスト
- [ ] \`npm test\` 通過

# 後続

- T021: 未登録時の強制誘導ガード + 送信無効化

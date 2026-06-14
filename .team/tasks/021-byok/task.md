---
id: 021
title: BYOK: 未登録時の強制誘導ガード + 送信無効化
priority: high
depends_on: [020]
created_by: surface:274
created_at: 2026-05-05T09:08:30.414Z
---

## タスク
# 目的

BYOK 必須なので、OpenRouter キーが未登録の状態ではチャット入力・送信を無効化し、設定画面に誘導する。

# 背景

- BYOK 必須化（system 鍵フォールバックなし）
- 友人が初めて使う時、まずキーを登録する流れにする
- T020 で実装される \`<SettingsDialog />\` を使う

# 仕様

## 起動時挙動
- editor 起動時に \`GET /api/secrets\` を取得
- \`openrouter.set === false\` の場合:
  1. チャット送信エリアを無効化（input disabled + 半透明 + プレースホルダ「使い始めるには『設定』からアクセスキーを登録してください」）
  2. SettingsDialog を自動で開く
  3. 開いた状態で「あとで」のような閉じるボタンは出すが、再度入力欄は無効のまま

## OpenRouter のみ必須
- gemini / cloudflare / firebase は任意（画像生成・デプロイは追加機能）
- 未登録のまま、それらの機能を使おうとした時にだけそれぞれ案内

## デプロイガード
- 「公開する」アクションで cloudflare/firebase が未登録なら、エラーメッセージ + 設定画面に誘導
- T019 のサーバー側ガードに対応する UI

## 画像生成ガード
- nano-banana を使う前提のフロー（あれば）で gemini 未登録時は警告

# テスト

- 起動時 GET /api/secrets で openrouter.set=false → 入力欄が disabled
- 同上で SettingsDialog が自動表示
- 保存して openrouter.set=true → 自動で入力欄が有効化
- デプロイボタン押下で未登録なら案内 → 設定画面オープン

# 完了条件

- [ ] チャット入力ガード実装
- [ ] 自動オープン
- [ ] デプロイ・画像生成ガード（最低限のメッセージ）
- [ ] テスト
- [ ] \`npm test\` 通過

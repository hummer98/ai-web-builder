# 次セッション計画: OPENCODE.md 改善 + モデル比較検証

## 目的

AI（OpenCode）が非エンジニアの曖昧な指示からサイト全体を生成できるようにする。

## 前提

- ユーザーペルソナ: 非エンジニアの友人（CLAUDE.md に定義済み）
- 現状: AI がファイル編集を十分に行わない（#27）、プレビューに反映されない（#28）
- モデル比較で max_tokens 不足が主因と判明。システムインストラクション不足も疑い

## Phase 1: ローカル検証環境の構築

- [ ] `npm run dev` でローカル起動確認（Agent Server + OpenCode + Vite + Hono）
- [ ] `workspace/opencode.json` のモデル切替が即時反映されることを確認
- [ ] リセット → プロンプト → git diff → リセットのサイクルをスクリプト化

## Phase 2: OPENCODE.md 調査・改善

### 調査対象
- [ ] OpenCode（sst/opencode）公式ドキュメント — OPENCODE.md の仕様・書き方
- [ ] Cursor の .cursorrules — ベストプラクティス
- [ ] Claude Code の CLAUDE.md — 効果的な指示の書き方
- [ ] Aider の .aider* 設定 — コード生成 AI への指示パターン

### 改善ポイント
- [ ] ロール定義: 「あなたは非エンジニア向けの Web サイト構築 AI です」
- [ ] 行動指針: 「曖昧な指示から完全なサイトを生成すること」
- [ ] ツール使用指示: 「必ずファイルを作成・編集すること」
- [ ] サイト生成の具体手順: ステップバイステップ

## Phase 3: モデル比較（OpenCode 経由）

### テスト対象モデル
1. Claude Sonnet 4.6 (`anthropic/claude-sonnet-4.6`)
2. Gemini 3.1 Pro (`google/gemini-3.1-pro-preview`)
3. Kimi K2.5 (`moonshotai/kimi-k2.5`)
4. Qwen3.5 397B (`qwen/qwen3.5-397b-a17b`)
5. GLM 5 Turbo (`z-ai/glm-5-turbo`)

### テストプロンプト（ペルソナ準拠）
1. 「おしゃれなカフェのサイトを作って。店名は Café Lumière。」
2. 「ヘッダーの色を変えて。もっと暖かい感じに。」
3. 「お問い合わせフォームを追加して。」
4. 「なんかイマイチ。もっとおしゃれにして。」

### 評価基準
- 生成されたファイル数
- コンポーネント構成の適切さ
- セマンティック HTML の遵守（OPENCODE.md ガイドライン）
- Vite HMR でのプレビュー反映
- 応答速度
- コスト

## Phase 4: HMR 反映の修正（#28）

- [ ] Vite ログ確認（HMR が発火しているか）
- [ ] 問題に応じて修正（watch 設定 or iframe リロードフォールバック）

## 成果物

- 改善された OPENCODE.md
- モデル比較レポート（推奨モデルの選定）
- HMR 修正
- 動作するデモ動画

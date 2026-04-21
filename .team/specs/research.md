# 調査結果統合: OPENCODE.md ベストプラクティス

## 主要な発見

1. **ファイル名は `AGENTS.md` が正式** — OpenCode は `AGENTS.md` > `CLAUDE.md` > `CONTEXT.md` の順で検索。`OPENCODE.md` は認識されない
2. **ロール定義・ペルソナ・デフォルト行動が欠落** — AI の行動原則が未定義
3. **曖昧な指示の解釈パターンが必要** — 「おしゃれ」「いい感じに」の変換ルール
4. **ファイル編集ツールの積極使用を明示** — テキスト回答ではなく実装を促す
5. **計画→実行→検証のワークフロー** — v0/bolt.new/Lovable 全てが採用する共通構造

## AGENTS.md 改善アクション

### 必須変更
- `container/scaffold/OPENCODE.md` → `container/scaffold/AGENTS.md` にリネーム
- `start.sh` の同期対象も変更

### 追加すべきセクション
1. **Identity（ロール定義）**: 非エンジニア向け Web サイト構築 AI
2. **User Context（ペルソナ）**: 技術用語を使わない、曖昧な指示を出す
3. **Default Behaviors（デフォルト行動）**: 「おしゃれ」→配色改善、「カフェ」→4セクション構成
4. **Few-shot Examples（入出力例）**: 曖昧指示→具体的アクション
5. **Tool Usage（ツール使用指針）**: 必ずファイルを編集する、テキスト説明だけで終わらない
6. **Workflow（ワークフロー）**: 計画→実装→検証の3段階

### 維持すべきセクション（既に良い）
- コンポーネント設計ガイドライン（セマンティック HTML）
- 編集後の必須検証（自己修復ループ）
- レスポンシブデザイン
- フォーム送信

## 参照元
- researcher-1: sst/opencode 公式仕様（AGENTS.md、システムプロンプト組み立て）
- researcher-2: Cursor .cursorrules（ロール定義、行動指針、Few-shot パターン）
- researcher-3: v0/bolt.new/Lovable のシステムプロンプト分析

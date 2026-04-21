---
id: 006
title: OpenCode 画像アップロードハング対応の改修実装
priority: high
depends_on: [005]
created_by: surface:289
created_at: 2026-04-19T14:41:25.896Z
---

## タスク
## 背景

タスク T005 で画像アップロード + プロンプト送信時の 4 分ハングを再現し、opencode ログを観察して真因を特定した。本タスクでは T005 のレポートに基づいて必要な改修を実装する。

## 前提

- **必ず先に `.team/output/T005-report.md` を読む**（T005 の調査レポート）
- 本番アプリ `ai-web-builder` には一切触らない（deploy, secrets, ssh 書き込み禁止）
- 作業ブランチを切る（main から `fix/image-upload-hang` など）。main 直 commit はしない

## 設計済みの改修案（A-E）

レポートで特定された真因に応じて、該当するものを選定・実装する:

- **A: buildPrompt 強化** — `container/agent-server/src/utils.ts:42-47` で imageUrl を埋め込む箇所に、絶対パス（例: `public/uploads/<filename>`）と `<img src=\"/uploads/<filename>\">` のコード例を追記。Claude がどこにファイルがあるか・どう参照するかを理解できるようにする
- **B: AGENTS.md 追記** — `container/scaffold/AGENTS.md` の「画像」関連セクションの近くに「ユーザーがアップロードした画像」のセクションを追加。`public/uploads/` に保存されること、`/uploads/<filename>` で参照できることを説明
- **C: promptAsync の multimodal 化** — `container/agent-server/src/index.ts:117-122` で text パートに加えて file パートで画像を直接渡す（OpenCode SDK のドキュメントを確認の上で対応可否判断）
- **D: deadline/timeout** — agent-server で promptAsync 後に SSE イベントが一定時間（180s 程度）来なかったら WS クライアントにタイムアウトを通知する。OpenCode セッションは cancel する
- **E: uploads と images の統合** — `public/uploads/` を `public/images/uploads/` などに統合、あるいは nano-banana の保存先と一元化してユーザー・AI 両方から同じ命名規則で参照できるようにする

T005 のレポートで真因に直接効く改修を優先し、真因と無関係な改修は後回しにする。

## 実装ルール

- 各改修にテストを書く（`vitest`、ファイルは対象の隣に `*.test.ts`）
- **ユニットテストだけで改修完了としない**。E2E に相当する動作は T008 で検証されるが、ユニットレベルでは:
  - A/B: buildPrompt の出力をスナップショット的に検証
  - C: promptAsync の呼び出し引数を OpenCode モックで検証
  - D: fake timer で deadline 到達時に WS にタイムアウトメッセージが送られることを検証
- `npm test` 全テスト通過
- `npm audit --audit-level=high` で HIGH 以上の脆弱性なし
- シークレットをコードに混入させない（`process.env` 経由）
- ログにシークレットを出さない

## 成果物

1. feature branch 上のローカル commit（複数 commit でも可）
2. `.team/output/T006-report.md`:
   - 採用した改修（A-E のうちどれか）とその根拠（T005 のレポートのどの記述に基づくか）
   - 採用しなかった改修と理由
   - テスト結果
   - feature branch 名
3. `npm test` / `npm audit` の出力抜粋

## 禁止事項

- `ai-web-builder`（le-serpent 本番）への一切の変更
- `flyctl deploy` の実行（デプロイは T007 で行う）
- `git push`（push は後続タスクまたは手動で行う）
- main ブランチへの直接 commit

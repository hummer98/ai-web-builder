---
id: 004
title: AGENTS.md を ai-web-builder 共通インストラクションとゲストサイト固有に分離する
priority: medium
created_at: 2026-04-19T14:14:24.981Z
---

## 背景

現状 `container/scaffold/AGENTS.md` にはビルダー共通の指示（MCP 検証フロー、セマンティックタグ原則、禁止事項等）とゲストサイト固有の指示（ペルソナ、Phase 1/2 骨組み手順、画像生成ルール等）が混在している。この AGENTS.md は `start.sh:66` で毎回ゲストワークスペースに上書きコピーされており、ゲストリポジトリ側で調整する余地がない。ビルダー共通要件とサイト固有要件を分離したい。

## 方針

OpenCode の `instructions` フィールド（`opencode.json`）を活用して、ai-web-builder 側の共通インストラクションとゲスト側の `AGENTS.md` をマージ読み込みさせる。OpenCode は `instructions` に列挙されたファイルを AGENTS.md と一緒に system prompt へ連結する公式仕様（glob / リモート URL も可）。

## 成果物

1. **`container/instructions/common.md` を新規作成** — ビルダー共通の普遍ルールを集約:
   - MCP 自己検証フロー（screenshot / console / log-reader）
   - コンポーネント設計ルール（セマンティックタグ表）
   - 禁止事項（最小変更禁止、`data-oc-id` 手動付与禁止、`@tailwind` 禁止等）
   - 画像生成（nano-banana）の基本ルール
   - レスポンシブ検証要件

2. **`container/scaffold/AGENTS.md` をゲスト固有に縮約**:
   - デザイナーペルソナ
   - 曖昧指示の解釈表
   - Phase 1/2 の骨組み手順
   - そのサイト固有のセクション構成方針

3. **`container/start.sh` を修正** — 既存の `opencode.json` 書き換え処理（`start.sh:69-79`）と同様の方式で `instructions: ["/app/container/instructions/common.md"]` を注入。`AGENTS.md` コピー処理は維持。

4. **`container/scaffold/opencode.json`** — ローカル開発時は相対パス `../instructions/common.md` も動くよう検討（optional）。

## 確認観点

- [ ] 編集後のファイル分割で、OpenCode が両方の指示を反映してセッションを進めることを実地で確認（1 件サイト生成させて出力が従来と同等以上）
- [ ] `le-serpent.club` 本番で `editor.le-serpent.club` が問題なく起動する
- [ ] `container/scaffold/AGENTS.md` のテストが既存なら壊れていない

## 非対象

- ゲストリポジトリごとに異なる「サイト固有の追加指示」を `AGENTS.md` 外部から挿入する仕組み（これは後続タスクで検討）
- グローバル `~/.config/opencode/AGENTS.md` の活用

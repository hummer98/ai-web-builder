---
id: A005
type: report
title: "テスト・デモ・機能・プロンプト・アーキテクチャの監査"
created: 2026-05-03T00:06:02Z
author: master
tags: [audit, tests, demos, prompts, architecture, gap-analysis]
---

## 概要

ai-web-builder の現状を「テストデータ・デモ」「Web サイト構築機能の網羅性」「アーキテクチャとプロンプトの改善余地」の 3 軸で監査した結果。

調査対象:
- `e2e/demo.spec.ts`, `container/agent-server/src/*.test.ts`, `container/log-reader-mcp/src/handlers.test.ts`
- `docs/use-cases.md`, `docs/architecture.md`
- `container/instructions/common.md`, `container/scaffold/AGENTS.md`, `workspace/OPENCODE.md`
- `container/scaffold/{src,functions}`, `container/agent-server/src/{ws-handler,chat-handler,utils,site-init,git-ops}.ts`

---

## 詳細

### 1. テストデータ・デモの不足

#### 1-1. デモシナリオが「カフェ1業種」のみ
`e2e/demo.spec.ts` Step 0–7 はカフェのみ。LLM の業種別汎化を測れない。`scripts/model-compare.sh` がある以上、業種マトリクス × モデルの eval セットが望ましい。

不足する業種シナリオ:
- 美容室・サロン（予約導線、料金表）
- ピアノ教室・塾（体験申込、アクセス）
- 写真スタジオ・ポートフォリオ（ギャラリー）
- 士業・コンサル（長文プロフィール、お問い合わせ重視）
- イベント告知 1 ページ（OGP、地図）
- EC ミニ（カード並び、購入導線）

#### 1-2. ペルソナ準拠のカバレッジ抜け
demo.spec で叩かれていない主要ユースケース:
- 画像 D&D による差替え（UC 4.2 / 4.4）— fixture 画像が無い
- 「3 つ前に戻して」/履歴 UI からの revert（UC 8.2）
- 公開 (deploy) の実行と URL 表示（UC 7.1）— Cloudflare モック必須
- 「もっとおしゃれにして」「なんかイマイチ」（UC 9.6）
- 要素指定編集の unit テスト（Step 3 にあるが unit 化されていない）

#### 1-3. ネガティブ／境界系テスト欠如
- WS スキーマ検証が無い（CLAUDE.md 要求 vs 実装）→ **改善実装済み（A006 参照）**
- 長文・絵文字・URL 貼付・空文字での detectCommand / buildPrompt
- OpenCode タイムアウト/再接続の WS 側挙動
- 自己修復ループ NG 時の autoCommit ガード → **改善実装済み（A006 参照）**

#### 1-4. 外部依存のモックなし
GitHub App / OpenRouter / Cloudflare API のモック層なし。CI では nock / msw でスタブ整備が要る。

#### 1-5. Visual regression が緩い
`e2e/results/` にスクリーンショット保存のみで構造アサーションなし。`<h1>` 単数性、ナビリンク数、フォーム必須フィールドの存在程度は安く入る。

### 2. Web サイト構築機能の網羅性

`docs/use-cases.md` で網羅評価されているが、実装と突合すると致命的なギャップあり:

| 重要度 | 機能 | 現状 | 課題 |
|---|---|---|---|
| ★★★ | お問い合わせの**通知** | `functions/api/index.ts:30` で `data/submissions.json` に追記のみ | 友人が届いた問い合わせを見られない。Workers では FS 永続化不可。Resend / Cloudflare Email Routing 必須 |
| ★★★ | 本番プレビュー（UC 7.4） | Vite Dev のみ | デプロイ後に「画像が出ない」「ルーティング壊れた」が起きる。`vite build && vite preview` を deploy 前に挟むべき |
| ★★ | ブログ・お知らせ（UC 6.3） | ❌ | 静的 MDX/JSON で十分（D1 不要）。`content/posts/*.md` を読む構造で実装軽い |
| ★★ | 変更 diff 表示（UC 8.4） | ❌ | git log は出るが diff サマリ無し |
| ★ | sitemap / robots.txt | 確認できず | SEO 基本セット |
| ★ | 多言語・ニュースレター・EC | ❌ | スコープ外で OK だが、prompt で明示しないと AI が暴走しうる |
| ★ | a11y 検証 | semantic tag 規則のみ | axe-core を視覚検証ループに追加 |
| ★ | パフォーマンス検証 | 無し | nano-banana 4K 画像で重くなりうる |

### 3. アーキテクチャの改善点

| # | 課題 | 状態 |
|---|---|---|
| 3-1 | AI が壊した状態をコミットしてしまう（`ws-handler.ts:76` で必ず `autoCommit("AI edit")`） | **A006 で改善済み** |
| 3-2 | コミットメッセージが固定 `"AI edit"`（`truncateForCommit` 未使用） | **A006 で改善済み** |
| 3-3 | 要素指定時の最小変更ルールが prompt に無い | **A006 で改善済み** |
| 3-4 | `detectCommand` が完全一致のみ。「もう公開しちゃっていい？」等は素通り | 未対応 |
| 3-5 | WS 受信時の zod 検証が抜けている（CLAUDE.md 要求 vs 実装） | **A006 で改善済み** |
| 3-6 | Source Locator のコンテキストが薄い（行スニペットなし） | 未対応 |
| 3-7 | nano-banana の暴走防止ルールなし | **A006 で改善済み（prompt に上限明記）** |
| 3-8 | opencode/vite/hono のログが plain text（service フィールド無し） | 未対応 |
| 3-9 | OpenCode セッションの肥大化対策なし | 未対応 |

### 4. プロンプトの改善点

| # | 課題 | 状態 |
|---|---|---|
| 4-1 | common.md の「最小変更禁止」が要素指定編集を阻害 | **A006 で改善済み** |
| 4-2 | AGENTS.md に業種別ヒントなし | **A006 で改善済み** |
| 4-3 | HELP_TEXT が機能羅列のみ | 未対応 |
| 4-4 | モデル戦略がタスク別になっていない（Sonnet 固定） | 未対応 |
| 4-5 | 自己修復ループの強制力が弱い（呼ばれたか確認していない） | 未対応 |
| 4-6 | a11y / SEO 規範が手薄 | **A006 で改善済み** |

---

## 結論

監査で挙げた項目のうち **2, 3, 4, 7（commit メッセージ・commit gate・zod 検証・プロンプト整理）は本セッションで実装済み**（A006 参照）。

残課題の優先度:
1. ★★★ お問い合わせ通知（Resend / Email Routing）
2. ★★★ 本番プレビュー（`vite build && vite preview`）
3. ★★ E2E デモの業種マトリクス化
4. ★★ 外部 API モック整備
5. ★ プロンプト改善の続き（HELP_TEXT、モデル戦略、検証ループ強制）
6. ★ ブログ／diff 表示／a11y 検証

## 推奨事項

- お問い合わせ通知は scaffold レベルで Resend を組み込む。サイトの実用性に直結
- 本番プレビューは deploy 前のセーフティネット。実装数行で済む
- 業種マトリクス eval は `scripts/model-compare.sh` の拡張で対応可。LLM 選択判断の客観化に直結
- ブログ機能は D1 待たず、静的ファイル + 公開時ビルドで先行可能

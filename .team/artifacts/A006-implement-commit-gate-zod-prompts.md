---
id: A006
type: session
title: "commit メッセージ改善・commit gate・zod 検証・プロンプト整理の実装"
created: 2026-05-03T00:06:02Z
author: master
tags: [implementation, ws-handler, zod, commit-gate, prompts, a11y, seo]
---

## 目的

A005 の監査で抽出した残課題のうち、ユーザー指定の項目 2, 3, 4, 7 を実装する:

- (2) commit メッセージを意味のある文字列にする
- (3) 壊れた状態の commit を防ぐ commit gate
- (4) WS 受信メッセージに zod 検証を追加
- (7) プロンプト整理（common.md / AGENTS.md）

## 実施内容

### (2) commit メッセージ改善

- `container/agent-server/src/ws-handler.ts`:
  - `truncateForCommit` を import
  - WS connection closure に `lastUserMessage` を保持
  - `onMessage` の `data.type === "chat"` 分岐で `lastUserMessage = data.message`
  - `session.idle` で `truncateForCommit(lastUserMessage)` を commit message として使用、`type: "git"` イベントに `message` フィールドを追加して送信
- これにより履歴 UI（UC 8.3）が「ヘッダーを青くして」「全体を明るくして」のように人間に読める一覧になる

### (3) Commit gate

- `container/agent-server/src/verify.ts` 新規:
  - `verifyServers({ timeoutMs, viteUrl, honoUrl })` を実装
  - Vite (`localhost:5173/`) と Hono (`localhost:3000/api/health`) を AbortController で 3 秒タイムアウト fetch
  - 5xx と接続失敗のみ NG、4xx は「サーバーは生きている」と OK 扱い、3xx redirect も OK
  - `VITE_PORT`, `HONO_PORT`, `VERIFY_HOST` 環境変数で上書き可能
- `container/agent-server/src/verify.test.ts` 新規:
  - node:http のモックサーバーで 4 ケース検証（200 OK / 接続不可 / 5xx / 404）
- `ws-handler.ts:session.idle` で commit 前に `verifyServers()` を呼ぶ:
  - NG なら commit せず `type: "warning"` を WS に送る（メッセージ: 「編集後にプレビューが応答していません。表示が崩れている可能性があります。元に戻すか、もう一度指示してください。」）
  - OK なら従来通り `autoCommit` → `autoPush`

### (4) Zod 検証

**注**: 並行して別エージェントが T012 タスク（`10d7c75 fix(security): authn / input validation for WS, Cloudflare Access, GitHub ops`）を実装し、本セッションの終盤にマージされた。これに `ws-schema.ts`（単数形）と zod 検証が含まれていたため、本セッションで作成した重複する `ws-schemas.ts`（複数形）は削除し、T012 の実装を採用した。

T012 の実装内容（agent-server/src/ws-schema.ts）:
- discriminated union schema: `chat / undo / history / revert / deploy / create-site / import-repo`
- `parseWsMessage()` ヘルパーで `{ ok, data | error }` を返す
- `chat.message` 最大 20000 文字、`revert.hash` 16進、`siteName/repoName` は `^[a-zA-Z0-9_-]{1,100}$`
- `ws-handler.ts:onMessage` で safeParse 後に `handleMessage` にディスパッチ

依存追加（zod）も T012 側で実施済み。

### (7) プロンプト整理

`container/instructions/common.md`:
- 新規セクション「**対象要素が指定されている場合（部分編集）**」: `## 対象要素` を含む chat では指定要素のみ変更するルールを明文化
- 新規セクション「**アクセシビリティ**」: alt / `<button>` vs `<a>` / label / aria-label / コントラスト 4.5:1 / focus リング / 見出しレベル順序
- 新規セクション「**SEO とメタ情報**」: title / meta description / OGP 3 種 / `<html lang="ja">` / ファビコン
- 「禁止事項」を「**初回のサイト生成時**に最小変更で済ませる」とスコープ修正（要素指定編集を阻害しないように）
- 画像生成セクションに「1 セッション最大 5 枚 / 同用途で複数枚生成しない」の上限を追加

`container/scaffold/AGENTS.md`:
- 新規セクション「**業種別ヒント**」: カフェ / 美容室 / 教室 / 写真スタジオ / 士業 / ポートフォリオ / イベント告知の 7 業種について「必須セクション・配色方向性・Hero 画像プロンプト例」をテーブル化
- 配色は LLM 自動選定でなく `index.css` の CSS 変数として定義する規範を追加

`container/agent-server/src/instructions-common.test.ts`:
- 新規キーワード追加: `対象要素`, `aria-label`, `コントラスト`, `og:image`, `meta name="description"`

### テスト結果

- 最終: **291 tests / 21 files、全 PASS**（T012 マージ後の状態。verify.test.ts 4 ケース追加分を含む）
- T012 マージ後に `safe-regex2` (log-reader-mcp) と `@hono/zod-validator` (scaffold) の `npm install` が必要だった

## 発見・学び

- `instructions-merged.test.ts` と `scaffold-agents.test.ts` の役割分担が明確: 共通ルール系キーワード（nano-banana, 最小変更, @tailwind 等）は **common.md にのみ書き AGENTS.md には書かない** という構造的なテストが存在
  - prompt 編集時はこの 2 ファイルの整合性を必ず保つ
  - 業種別ヒント表のヘッダーから「nano-banana」文字列を削除し、画像生成上限ルールを common.md 側に移動して整合性を保った
- AGENTS.md は「ゲストサイト固有のワークフロー」、common.md は「ゲスト横断の技術ルール」という分担が `scaffold-agents.test.ts:forbidden` で機械的に保証されている
- ws-handler.test.ts は `session.idle` を発火させていないので、commit gate 追加は既存テストに影響しない
- zod 4 の discriminated union で `data.type` 分岐の型ナラリングが効くため、各 if 分岐内のフィールドアクセスは型安全に書ける

## 次のアクション

A005 の残課題から（優先順）:

1. **お問い合わせ通知**を scaffold に組み込む（Resend or Cloudflare Email Routing）
2. **本番プレビュー** (`vite build && vite preview`) を deploy 前に挟む
3. **E2E デモを業種マトリクス化**（最低 3 業種）
4. **外部 API モック**整備（OpenRouter / GitHub / Cloudflare）
5. プロンプト改善の続き: HELP_TEXT を導線型に、モデル戦略のタスク別切替、自己修復ループの呼出し強制チェック

## 変更ファイル（T012 マージ後の最終差分）

| ファイル | 変更種別 |
|---|---|
| `container/agent-server/src/ws-handler.ts` | 修正（commit gate + commit message を T012 後の構造に再適用） |
| `container/agent-server/src/verify.ts` | 新規 (本セッション) |
| `container/agent-server/src/verify.test.ts` | 新規 (本セッション、4 ケース) |
| `container/agent-server/src/instructions-common.test.ts` | キーワード更新 |
| `container/instructions/common.md` | 部分編集 / a11y / SEO / 画像上限を追加 |
| `container/scaffold/AGENTS.md` | 業種別ヒント表を追加 |

`ws-schemas.ts` / `ws-schemas.test.ts` は T012 と重複するため削除。zod 依存も T012 側で追加済み。

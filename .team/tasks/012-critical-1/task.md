---
id: 012
title: セキュリティ Critical 1: 認証・入力検証の構造修正
priority: high
created_by: surface:104
created_at: 2026-05-02T16:25:59.007Z
---

## タスク
コードレビュー (2026-05-03) で発見された Critical 群のうち、認証と入力検証の構造修正を行う。

## 背景

CLAUDE.md に明記されている「WebSocket メッセージは受信時にスキーマ検証」「Hono ルートは Zod で検証」が構造的に未実装。Cloudflare Access JWT も署名検証されておらず、`/ws` は認証ミドルウェアから完全に除外されている。Fly.io が直接公開されているため、現状は実質無認証。

## 対応項目

### 1. WebSocket メッセージの Zod 検証 (CLAUDE.md 違反)
- 対象: `container/agent-server/src/ws-handler.ts:311-312` 付近の `onMessage`
- 現状: `JSON.parse` に try/catch なし、`data.type` / `data.hash` / `data.owner` / `data.repoName` / `data.count` 等が無検証で git 操作・GitHub API に流入
- 方針:
  - `zod` で `discriminatedUnion("type", ...)` を定義
  - 各メッセージタイプ: `chat`, `revert`, `history`, `undo`, `deploy`, `create-site`, `import-repo` 等を網羅
  - `hash` は `z.string().regex(/^[0-9a-f]{4,40}$/)`、`count` は `z.number().int().min(1).max(100)`、`siteName`/`repoName` は `z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)`
  - 不正 JSON / スキーマ不一致は WS で `{type:"error",message:"Invalid message"}` を返して握り潰す（接続は維持）
- テスト: `ws-handler.test.ts` に「不正 JSON」「未知 type」「hash regex 違反」「count 範囲外」のケースを追加

### 2. Cloudflare Access JWT 署名検証
- 対象: `container/agent-server/src/app.ts:52-54`
- 現状: ヘッダー存在チェックのみで通過
- 方針:
  - `jose` ライブラリで JWKS 検証 (`createRemoteJWKSet` + `jwtVerify`)
  - 環境変数 `CLOUDFLARE_ACCESS_AUD` と `CLOUDFLARE_ACCESS_TEAM_DOMAIN` を必須化（起動時バリデーション）
  - 検証失敗時は 401
- ローカル開発では Basic 認証フォールバックを残す（既存の挙動を維持）
- テスト: `app.test.ts` に「JWT なし」「不正 JWT」「正規 JWT」「AUD 不一致」のケース

### 3. `/ws` を認証ミドルウェアの対象に含める
- 対象: `container/agent-server/src/app.ts:35` 付近
- 現状: `c.req.path === "/ws"` で素通り
- 方針:
  - WebSocket アップグレード時に Origin ヘッダーを許可リストと照合
  - JWT 認証も WS で適用（クッキー or 初回メッセージ経由のいずれか、調査して妥当な方を選択）
- テスト: 認証なし WS 接続の拒否テスト

### 4. 任意 owner / repoName でのリポジトリ操作の制限
- 対象: `container/agent-server/src/ws-handler.ts:461-508` (`create-site` / `import-repo`)
- 方針:
  - `owner` は環境変数 `GITHUB_OWNER` から固定参照、ユーザー入力からは受け取らない
  - `siteName` / `repoName` は項目 1 の Zod 正規表現で検証

### 5. getHistory の count 上限
- 対象: `container/agent-server/src/git-ops.ts:96-101` (`getHistory`)
- 方針: 関数内でも `Math.max(1, Math.min(100, Math.floor(count)))` で防御（項目 1 の Zod 検証と二重防御）
- テスト: `git-ops.test.ts` に大値・負値のケース

### 6. log-reader-mcp の正規表現 ReDoS 対策
- 対象: `container/log-reader-mcp/src/handlers.ts:77` (`searchLog`)
- 現状: `pattern` を `new RegExp(pattern, "i")` に直接渡し
- 方針:
  - `pattern.length` を 200 文字に制限
  - `safe-regex` ライブラリ等で危険パターンを拒否、または `vm` でタイムアウト付き実行
- テスト: `handlers.test.ts` に長すぎる pattern と既知の ReDoS パターン (`^(a+)+$` 等) の拒否

## 完了条件

- 全項目について本番コード修正 + テスト追加
- `npm test` がすべて pass
- `npm run typecheck` (もしあれば) がエラーなし
- 修正後、CLAUDE.md のセキュリティガイドライン項目を docs に明記

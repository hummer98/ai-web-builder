---
id: 013
title: セキュリティ Critical 2: シークレット漏洩・XSS 対策
priority: high
depends_on: [012]
created_by: surface:104
created_at: 2026-05-02T16:26:32.330Z
---

## タスク
コードレビュー (2026-05-03) で発見された Critical 群のうち、シークレット保護と XSS 対策を行う。

## 背景

GitHub App Installation Token が `git push` 失敗時のエラーログに平文で漏れている。SVG アップロードで Stored XSS 可能。iframe ↔ 親ウィンドウの postMessage で origin 検証なし。`playwright.config.ts` にデフォルトパスワード平文ハードコード。

## 対応項目

### 1. GitHub App トークンのログ漏洩防止
- 対象:
  - `container/agent-server/src/git-ops.ts:67,70` (`autoPush` の catch)
  - `container/agent-server/src/site-init.ts:107,146` (push / clone の catch)
- 現状: `https://x-access-token:<TOKEN>@github.com/...` を含むコマンドが `Error.message` に入り、`String(err)` でログに流れる
- 方針:
  - 共通のサニタイザ関数を `utils.ts` に追加: `sanitizeError(err: unknown): string` で `x-access-token:[^@]+@` を `x-access-token:[REDACTED]@` に置換
  - 全箇所の `String(err)` をこのサニタイザに置き換え
  - 同様のパターンが他の場所にないかも grep で確認 (`git("push"` / `git("clone"` で authedUrl を渡している箇所)
- テスト: `utils.test.ts` にサニタイザ単体テスト + `git-ops.test.ts` で push 失敗時にログにトークンが含まれない回帰テスト

### 2. SVG アップロードによる Stored XSS の遮断
- 対象: `container/agent-server/src/app.ts:19,83-84` (`UPLOAD_MIME_TYPES`)
- 現状: `.svg` が許可され `Content-Type: image/svg+xml` で配信、SVG 内 `<script>` が同一オリジンで実行
- 方針:
  - `UPLOAD_MIME_TYPES` から `.svg` を削除（最も簡単で安全）
  - 友人ペルソナ的に SVG を AI 生成画像として使う動線が無いことを確認
  - 万一必要なら `Content-Disposition: attachment` で配信に変更
- テスト: `app.test.ts` に SVG アップロード拒否テスト

### 3. postMessage の origin 検証 (送信側 + 受信側)
- 対象:
  - 送信側: `container/scaffold/plugins/editor-overlay.ts:308,356,367,376`
  - 受信側 (iframe → 親): `editor/src/components/PreviewPanel.tsx:39-60`
  - 送信側 (親 → iframe): `editor/src/components/PreviewPanel.tsx:67`
  - 受信側 (iframe 内): `container/scaffold/plugins/editor-overlay.ts:143`
- 現状: `targetOrigin: "*"` / `e.origin` 未検証
- 方針:
  - 親 → iframe: `iframe.contentWindow.postMessage(payload, new URL(PREVIEW_URL).origin)` に変更
  - iframe → 親: `window.parent.postMessage(payload, window.location.ancestorOrigins?.[0] ?? "*")` ではなく、ビルド時に親 origin を埋め込むか、最初の handshake で親 origin を確定させる
  - 受信側両方: `e.origin` を期待 origin と照合
  - ローカル開発で同一オリジンにできない場合は `import.meta.env.DEV` で例外を許可
- テスト: 単体テストは難しいので、E2E or 手動確認手順を docs に記録

### 4. playwright.config.ts のデフォルトパスワード削除
- 対象: `playwright.config.ts:12`
- 現状: `process.env.DEMO_PASSWORD ?? "ai-web-builder-2026"` でリポジトリにデフォルト平文
- 方針:
  - デフォルト値を削除、`DEMO_PASSWORD` 未設定時は throw でテスト起動を止める
  - `.env.example` に `DEMO_PASSWORD=` の記載を追加 (値は空)

### 5. /api/contact (scaffold) の Zod 検証
- 対象: `container/scaffold/functions/api/index.ts:11-33`
- 現状: `name` / `email` / `message` の存在チェックのみ
- 方針:
  - `@hono/zod-validator` で `zValidator("json", schema)` を導入
  - スキーマ: `name: z.string().min(1).max(100)`, `email: z.string().email().max(254)`, `message: z.string().min(1).max(5000)`
  - `email` は改行を含まないことも明示 (ログインジェクション対策)
- テスト: scaffold 側にテストが無ければ最低限のリクエストテストを追加

## 完了条件

- 全項目について本番コード修正 + テスト追加
- `npm test` 全 pass
- 手動確認: postMessage が異なる origin から無視されることをブラウザで確認

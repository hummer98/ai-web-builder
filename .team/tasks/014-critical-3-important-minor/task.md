---
id: 014
title: セキュリティ Critical 3: 依存更新・コンテナ堅牢化・Important / Minor 群
priority: medium
depends_on: [013]
created_by: surface:104
created_at: 2026-05-02T16:27:11.681Z
---

## タスク
コードレビュー (2026-05-03) で発見された残りの Critical 2 件 (Vite 脆弱性 / sites.json) と Important / Minor 群をまとめて対応する。

## 対応項目

### Critical

#### 1. Vite HIGH 脆弱性の修正
- 対象: ルート / `editor/` / `container/scaffold/`
- 現状: Path Traversal, FS deny bypass, Arbitrary file read via WS dev server
- 方針:
  - 各ディレクトリで `npm audit fix` を実行
  - 動かなくなった場合は major bump も検討
  - `npm audit --audit-level=high` で 0 件になることを確認

#### 2. sites.json のメールアドレス漏洩
- 対象: リポジトリルートの `sites.json`
- 現状: ゲストのメールアドレスと GitHub リポジトリ名が git 追跡されている
- 方針:
  - 現在の値を Fly Secret として登録 (`flyctl secrets set SITES_JSON='...'`)
  - `.gitignore` に `sites.json` 追加
  - `git rm --cached sites.json` で履歴を残しつつ追跡解除
  - 起動時にシークレットから読み込む (`process.env.SITES_JSON` を JSON parse)
  - **注意**: 過去のコミット履歴に残るため、漏洩したと見なして関係者にメール変更を依頼する判断はユーザーに任せる (本タスクでは履歴書き換えはしない)

### Important

#### 3. ws-handler.ts のオーナーハードコード除去
- 対象: `container/agent-server/src/ws-handler.ts:163, 202`
- 方針: `"hummer98"` を `process.env.GITHUB_OWNER` に置き換え (Critical 1 と整合)

#### 4. undo の autoPush エラー握り潰し修正
- 対象: `container/agent-server/src/ws-handler.ts:119`
- 方針: `autoPush().catch((err) => log.error("Push after undo failed", { error: sanitizeError(err) }))` に変更

#### 5. undo / deploy の二重実装の統合
- 対象: `container/agent-server/src/ws-handler.ts:311-511` 周辺
- 現状: `handleCommand` 経由とボタン直接送信経由でレスポンス形式が異なる
- 方針: 共通の処理関数を作って両パスから呼ぶ。統一したレスポンス形式に揃える
- editor 側のクライアントコード (`ChatPanel.tsx`) も合わせて確認・修正

#### 6. アップロードハンドラの非同期 I/O 化
- 対象: `container/agent-server/src/app.ts:91, 94`
- 方針: `mkdirSync` / `writeFileSync` を `node:fs/promises` の `await mkdir` / `await writeFile` に変更

#### 7. useWebSocket の再接続レースコンディション + JSON.parse 例外
- 対象: `editor/src/hooks/useWebSocket.ts:19-29`
- 方針:
  - `setTimeout` の戻り値を保持し cleanup で `clearTimeout`
  - 再接続後の WebSocket にも onopen/onmessage/onclose を再設定
  - `JSON.parse` を try/catch で囲み不正メッセージは無視

#### 8. PreviewPanel useEffect 依存漏れ
- 対象: `editor/src/components/PreviewPanel.tsx:94-98`
- 方針: 依存配列に `toggleInspect` を追加 (eslint-plugin-react-hooks の exhaustive-deps を CI で有効化することも検討)

#### 9. scaffold の型解決エラー修正
- 対象: `container/scaffold/tsconfig.json` + `functions/api/index.ts:2` + `src/App.tsx:1`
- 現状: `react-router` / `@hono/node-server` の型解決失敗
- 方針: `package.json` を確認し不足パッケージを install。型エラーを解消することで AI の LSP フィードバックが正常化する

#### 10. opencode serve をループバックバインドに変更
- 対象: `container/start.sh:87`
- 方針: `--hostname 0.0.0.0` を `--hostname 127.0.0.1` に変更

#### 11. Dockerfile の非 root 化
- 対象: `Dockerfile`
- 方針: `RUN useradd -m app && chown -R app:app /app` + `USER app` を追加。`/data` のパーミッションも合わせて設定。Fly Volume マウント先のパーミッションを確認

### Minor (時間があれば)

- `ws-handler.ts` の `event.properties` 型アサーション → 型ガード化
- `chat-handler.ts:77-78` SDK 戻り値の二重キャスト解消
- `deploy.ts:80-103` `uploadAsset` デッドコード削除
- `git-ops.ts:146-171` `createIssue` デッドコード削除
- `app.ts:169-197` SPA フォールバック除外条件の重複を共通化
- `editor-overlay.ts:424` `console.log` 削除
- `editor/src/App.tsx:87` `fetch(fileData)` の型・意図明示
- `editor/src/components/ChatPanel.tsx` の `as { delta?: string }` 等を WSMessage discriminated union 化
- `editor/src/main.tsx:6` 非 null アサーションを明示的なガードに

## 完了条件

- Critical 2 件は必ず対応
- Important 群は可能な限り対応 (難航したら個別タスクに切り出して可)
- Minor 群は時間配分次第で取捨選択
- `npm test` / `npm audit --audit-level=high` がクリーン

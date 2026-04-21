# Implementation Design: Issues #27 & #28

## Issue #27: AI がサイトを十分に生成しない

### 問題
チャットで「カフェのサイトを作って」と指示しても、AI が h1 テキスト変更程度の最小変更しか行わない。

### 原因分析
- OpenCode はプロンプトを受け取り、セッションを作成し、LLM に送信できている（ログ確認済み）
- LLM は応答を返しているが、ファイル編集ツールを十分に活用していない
- OPENCODE.md のガイドラインは構造的だが、AI の行動を具体的に促す指示が弱い

### 対応方針
1. OPENCODE.md に「サイト生成時のステップバイステップ指示」を追加
2. buildPrompt で初回サイト生成時にはより具体的なコンテキストを提供
3. scaffold の App.tsx / Home.tsx をより編集しやすい構造に

### 変更ファイル
- `container/scaffold/OPENCODE.md`
- `container/agent-server/src/utils.ts` (buildPrompt 改善)
- `container/scaffold/src/pages/Home.tsx` (初期構造改善)

## Issue #28: プレビュー iframe に HMR が反映されない

### 問題
AI がファイルを編集しても、プレビュー iframe の表示が更新されない。

### 原因分析候補
1. Vite HMR WebSocket が iframe 内で接続されていない
2. iframe の src URL とVite の base パスの不一致
3. Vite が OpenCode のファイル編集を検知していない（ファイルシステム watch の問題）
4. iframe のキャッシュ

### 対応方針
1. Vite Dev Server のログを確認（HMR が発火しているか）
2. iframe 内のコンソールログを確認（HMR WebSocket 接続状態）
3. 問題に応じて修正:
   - Vite の watch 設定調整
   - iframe の自動リロード機能追加（HMR が効かない場合のフォールバック）
   - base パスの修正

### 変更ファイル
- `container/scaffold/vite.config.ts` (HMR 設定)
- `editor/src/components/PreviewPanel.tsx` (iframe リロード)
- `container/start.sh` (Vite 起動オプション)

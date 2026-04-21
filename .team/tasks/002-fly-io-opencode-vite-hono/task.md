---
id: 002
title: 本番 Fly.io で opencode/vite/hono のログを診断可能にする
priority: high
created_at: 2026-04-19T12:40:33.563Z
---

## タスク
## 背景

2026-04-19 に editor.le-serpent.club から画像付きプロンプトを投げたところ、4分以上無応答となりクライアント側 WebSocket がタイムアウトした。`flyctl logs` を確認したところ、agent-server のログ（`promptAsync sent` まで）は追えたが、**OpenCode 側のログが一切出ていない**ため、どこでハングしていたか特定できなかった。

根本原因: `container/start.sh` で agent-server 以外の 3 プロセス (opencode / vite / hono) のログをファイルのみにリダイレクトしており、Fly stdout に乗らない。しかも Fly Machine の root FS は ephemeral なので、autostop/再起動で `/app/logs/` の内容は消える。

## 対象ファイル

- `container/start.sh` — ログのリダイレクト方法
- `CLAUDE.md` — 「ログ」節 + 新規「本番診断」節
- `fly.toml` — 必要なら Volume 設定を調整（`/data/logs` への永続化）

## 要件

### 1. 全プロセスを Fly stdout に流す

`container/start.sh:85-91` で opencode / vite / hono の各バックグラウンドプロセスを、ファイルと stdout の両方に流す。案:

```bash
# 例: opencode
opencode serve --port 4096 --hostname 0.0.0.0 2>&1 | tee -a "$LOGS_DIR/opencode.log" &
# vite / hono も同様
```

`exec` しているメインの agent-server は既に tee 済みなのでそのまま。

### 2. ログファイルを Fly Volume に永続化（オプション）

`LOGS_DIR` を `/app/logs` から `/data/logs`（既存の `workspace_data` Volume マウント配下）へ移す。マシン再起動後も直近ログを SSH で確認可能。ただしディスク容量圧迫リスクがあるため、以下のいずれかを選ぶ:

- A. stdout 集約 + ephemeral のまま（Fly logs の retention に任せる）
- B. Volume 永続化 + logrotate 相当を仕込む

最小実装としては A（stdout 集約のみ）でよい。B は将来対応でよいが CLAUDE.md に TODO として残す。

### 3. CLAUDE.md に本番診断の手順を追記

「ログ」節を拡張、または新規「本番診断」節を追加:

- `flyctl logs -a ai-web-builder` で agent-server / opencode / vite / hono が混在で流れる
- プロセス識別方法（prefix 付与 or そのまま JSON Lines の `service` フィールドで区別）
- `flyctl ssh console` で入って `tail -f /app/logs/*.log` を追う方法
- Machine 再起動で `/app/logs/` は消える旨の注意

### 4. ログ形式の一貫性（努力目標）

現状:
- agent-server.log → JSON Lines (`{ts, level, service, msg, ...}`)
- opencode.log → プレーンテキスト（opencode 本体の出力）
- vite.log / hono.log → それぞれのデフォルト

Fly stdout に混在させる以上、できれば `service=opencode` / `service=vite` / `service=hono` のプレフィックスを付けたい。ただし opencode/vite の出力を加工するのは複雑なため、今回はプレフィックスなしで stdout に流すだけでよい（CLAUDE.md にその旨明記）。

## 完了条件

- [ ] `container/start.sh` で opencode / vite / hono のログが Fly stdout に流れる
- [ ] ローカル `npm run dev` でも従来どおり `logs/*.log` に書き込まれる（デグレしない）
- [ ] `CLAUDE.md` の「ログ」節が本番診断手順を含む内容に更新されている
- [ ] `flyctl logs -a ai-web-builder` で opencode の起動メッセージが確認できる（本番検証）

## 非対象（今回やらない）

- Volume 永続化 + logrotate（TODO として CLAUDE.md に残す）
- ログの構造化統一（opencode/vite/hono の JSON 化）
- ログビューア UI / Sentry 連携等の外部ツール
- 元々の "プロンプトでタイムアウトする" 問題の根本原因調査（別タスクで実施）

## 補足: 今回のタイムアウト事象

このタスクは "今後同じ問題が起きたときに診断できるようにする" のが目的。タイムアウトの原因調査（MCP 初期化のハング / 画像 URL の扱い / LLM 応答遅延のどれか）は、本タスク完了後にログを見ながら別タスクで切り分ける。

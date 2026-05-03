#!/bin/bash
set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/data/workspace}"
LOGS_DIR="/app/logs"

# Fly Volume /data の owner を app (UID 1001) に揃える防御策。
# 非 root の USER app では失敗するが無害 (root 起動時のみ効く)。
# 既存 Volume を非 root 化したときは summary.md の手順に従って一時 Machine から chown すること。
if [ -d /data ]; then
  chown -R 1001:1001 /data 2>/dev/null || true
fi

mkdir -p "$LOGS_DIR"

echo "Starting AI Web Builder..."

# Fly Secret から sites.json を生成 (機密情報のためリポジトリには含めない)
if [ -n "$SITES_JSON" ]; then
  printf '%s' "$SITES_JSON" > /app/sites.json
  if ! jq -e . /app/sites.json > /dev/null 2>&1; then
    echo "Warning: SITES_JSON is not valid JSON; falling back to scaffold mode"
    rm -f /app/sites.json
  fi
fi

# SITE_DOMAIN が設定されていれば sites.json からリポジトリを clone
if [ -n "$SITE_DOMAIN" ] && [ -f /app/sites.json ]; then
  REPO=$(jq -r --arg d "$SITE_DOMAIN" '.[$d].repo // empty' /app/sites.json)
  if [ -n "$REPO" ]; then
    echo "Site: $SITE_DOMAIN → repo: $REPO"
    CLONE_URL="https://github.com/${REPO}.git"
    if [ -n "$GH_TOKEN" ]; then
      CLONE_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
    fi

    if [ -d "$WORKSPACE_DIR/.git" ]; then
      echo "Pulling latest changes..."
      cd "$WORKSPACE_DIR" && git pull origin main 2>&1 || true
    else
      # .git がなければ既存ワークスペースを退避して clone
      if [ -d "$WORKSPACE_DIR" ]; then
        echo "Replacing workspace with repo clone..."
        rm -rf "$WORKSPACE_DIR"
      fi
      echo "Cloning $REPO..."
      git clone "$CLONE_URL" "$WORKSPACE_DIR"
    fi
  fi
fi

# ワークスペースが空なら scaffold をコピー（リポジトリ未設定時のフォールバック）
if [ ! -f "$WORKSPACE_DIR/package.json" ]; then
  echo "Initializing workspace from scaffold..."
  mkdir -p "$WORKSPACE_DIR"
  cp -r /app/container/scaffold/. "$WORKSPACE_DIR/"
fi

# git リポジトリがなければ初期化（デモモード等）
if [ ! -d "$WORKSPACE_DIR/.git" ]; then
  echo "Initializing git repository..."
  cd "$WORKSPACE_DIR" && git init && git add -A && \
    git -c user.name="ai-web-builder[bot]" -c user.email="ai-web-builder[bot]@users.noreply.github.com" \
    commit -m "Initial scaffold"
fi

# scaffold の package-lock.json が変わっていたら node_modules を再同期
SCAFFOLD_LOCK="/app/container/scaffold/package-lock.json"
WORKSPACE_LOCK="$WORKSPACE_DIR/package-lock.json"
if ! diff -q "$SCAFFOLD_LOCK" "$WORKSPACE_LOCK" > /dev/null 2>&1 || [ ! -f "$WORKSPACE_DIR/node_modules/.bin/vite" ]; then
  echo "Syncing node_modules from scaffold image..."
  rm -rf "$WORKSPACE_DIR/node_modules"
  cp -r /app/container/scaffold/node_modules "$WORKSPACE_DIR/"
  cp "$SCAFFOLD_LOCK" "$WORKSPACE_LOCK"
fi

# root 起動時 (Volume 所有権リカバリモード) は同期後も WORKSPACE_DIR の所有権を
# 1001:1001 に統一しておく。次回 USER app 起動で rm -rf が失敗しないよう保険。
if [ "$(id -u)" -eq 0 ] && [ -d "$WORKSPACE_DIR" ]; then
  echo "Recovery mode: chowning $WORKSPACE_DIR to 1001:1001..."
  chown -R 1001:1001 "$WORKSPACE_DIR"
  echo "Recovery chown complete. Holding machine with minimal HTTP server (deploy without --build-arg to revert)."
  # vite/hono/opencode を root で起動すると .vite/deps/ 等を root 所有で書き戻して
  # しまうため、リカバリモードでは何も起動しない。Fly のヘルスチェック用に :8080
  # で 200 を返す最小サーバーだけ立てておく (このプロセスは何も書き込まない)。
  exec node -e 'require("http").createServer((_,r)=>{r.statusCode=200;r.end("recovery")}).listen(8080,"0.0.0.0",()=>console.log("recovery http on :8080"))'
fi

# scaffold の設定ファイルを常に最新に同期（ユーザーコンテンツ以外）
cp /app/container/scaffold/vite.config.ts "$WORKSPACE_DIR/vite.config.ts"
cp /app/container/scaffold/tsconfig.json "$WORKSPACE_DIR/tsconfig.json"
cp -r /app/container/scaffold/plugins/. "$WORKSPACE_DIR/plugins/"
cp /app/container/scaffold/opencode.json "$WORKSPACE_DIR/opencode.json"
cp /app/container/scaffold/AGENTS.md "$WORKSPACE_DIR/AGENTS.md"

# SITE_BRIEF.md は scaffold のテンプレを初回のみコピー（既存ユーザー編集を上書きしない）
if [ ! -f "$WORKSPACE_DIR/SITE_BRIEF.md" ]; then
  cp /app/container/scaffold/SITE_BRIEF.md "$WORKSPACE_DIR/SITE_BRIEF.md"
fi

# opencode.json の後処理: 共通 instructions / SITE_BRIEF の絶対パス注入 + nano-banana 環境変数
node /app/container/opencode-postprocess.mjs \
  "$WORKSPACE_DIR/opencode.json" \
  "--common=/app/container/instructions/common.md" \
  "--site-brief=${WORKSPACE_DIR}/SITE_BRIEF.md" \
  "--nano-banana-key=${GEMINI_API_KEY:-}"

# Vite のキャッシュクリア（NODE_ENV 変更時に必要）
rm -rf "$WORKSPACE_DIR/node_modules/.vite"

# Vite Dev Server (ゲストサイト) — development モードで起動、base=/preview/
# stdout/stderr を Fly stdout と $LOGS_DIR/vite.log の両方に流す
(cd "$WORKSPACE_DIR" && NODE_ENV=development VITE_BASE_PATH=/preview/ npx vite --host 0.0.0.0 --port 5173 2>&1 | tee -a "$LOGS_DIR/vite.log") &

# Hono Dev Server (バックエンド API)
# stdout/stderr を Fly stdout と $LOGS_DIR/hono.log の両方に流す
(cd "$WORKSPACE_DIR" && npx tsx watch functions/api/index.ts 2>&1 | tee -a "$LOGS_DIR/hono.log") &

# OpenCode serve (AI 編集エンジン)
# stdout/stderr を Fly stdout と $LOGS_DIR/opencode.log の両方に流す
(cd "$WORKSPACE_DIR" && opencode serve --port 4096 --hostname 127.0.0.1 2>&1 | tee -a "$LOGS_DIR/opencode.log") &

# Agent Server (メインプロセス — フォアグラウンド)
cd /app/container/agent-server && exec npx tsx src/index.ts 2>&1 | tee -a "$LOGS_DIR/agent-server.log"

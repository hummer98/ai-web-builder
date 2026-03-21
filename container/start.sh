#!/bin/bash
set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/data/workspace}"
LOGS_DIR="/app/logs"

mkdir -p "$LOGS_DIR"

echo "Starting AI Web Builder..."

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

# scaffold の設定ファイルを常に最新に同期（ユーザーコンテンツ以外）
cp /app/container/scaffold/vite.config.ts "$WORKSPACE_DIR/vite.config.ts"
cp /app/container/scaffold/tsconfig.json "$WORKSPACE_DIR/tsconfig.json"
cp -r /app/container/scaffold/plugins/. "$WORKSPACE_DIR/plugins/"
cp /app/container/scaffold/opencode.json "$WORKSPACE_DIR/opencode.json"
cp /app/container/scaffold/OPENCODE.md "$WORKSPACE_DIR/OPENCODE.md"

# Vite のキャッシュクリア（NODE_ENV 変更時に必要）
rm -rf "$WORKSPACE_DIR/node_modules/.vite"

# Vite Dev Server (ゲストサイト) — development モードで起動、base=/preview/
cd "$WORKSPACE_DIR" && NODE_ENV=development VITE_BASE_PATH=/preview/ npx vite --host 0.0.0.0 --port 5173 >> "$LOGS_DIR/vite.log" 2>&1 &

# Hono Dev Server (バックエンド API)
cd "$WORKSPACE_DIR" && npx tsx watch functions/api/index.ts >> "$LOGS_DIR/hono.log" 2>&1 &

# OpenCode serve (AI 編集エンジン)
cd "$WORKSPACE_DIR" && opencode serve --port 4096 --hostname 0.0.0.0 >> "$LOGS_DIR/opencode.log" 2>&1 &

# Agent Server (メインプロセス — フォアグラウンド)
cd /app/container/agent-server && exec npx tsx src/index.ts 2>&1 | tee -a "$LOGS_DIR/agent-server.log"

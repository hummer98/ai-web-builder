#!/bin/bash
set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/data/workspace}"
LOGS_DIR="/app/logs"

mkdir -p "$LOGS_DIR"

echo "Starting AI Web Builder..."

# ワークスペースが空なら scaffold をコピー
if [ ! -f "$WORKSPACE_DIR/package.json" ]; then
  echo "Initializing workspace from scaffold..."
  mkdir -p "$WORKSPACE_DIR"
  cp -r /app/container/scaffold/* "$WORKSPACE_DIR/"
  cp -r /app/container/scaffold/.* "$WORKSPACE_DIR/" 2>/dev/null || true
  cd "$WORKSPACE_DIR" && npm install
fi

# Vite Dev Server (ゲストサイト)
cd "$WORKSPACE_DIR" && npx vite --host 0.0.0.0 --port 5173 >> "$LOGS_DIR/vite.log" 2>&1 &

# Hono Dev Server (バックエンド API)
cd "$WORKSPACE_DIR" && npx tsx watch functions/api/index.ts >> "$LOGS_DIR/hono.log" 2>&1 &

# OpenCode serve (AI 編集エンジン)
cd "$WORKSPACE_DIR" && opencode serve :4096 >> "$LOGS_DIR/opencode.log" 2>&1 &

# Agent Server (メインプロセス — フォアグラウンド)
cd /app/container/agent-server && exec npx tsx src/index.ts 2>&1 | tee -a "$LOGS_DIR/agent-server.log"

#!/bin/bash
set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/data/workspace}"
LOGS_DIR="/app/logs"

# --- Fly Volume 所有権の自己修復 (root → app 降格パターン) ---
# コンテナは root で起動する。Fly Volume /data はデプロイ・再起動・autostop を
# またいでファイル所有権がそのまま残るため、過去に root 等 (UID≠1001) が書いた
# ファイルが 1 個でも混ざると、非 root 起動では chown も rm もできず起動不能に
# なる (「fly がパーミッションで壊れる」障害の真因)。
# そこで root のうちに /data を 1001 へ強制 chown して所有権を毎回自己修復し、
# gosu で app(UID 1001) に降格してから本体を起動する。これで手動の 2 段階
# リカバリ (RUN_AS_USER=root デプロイ) は不要になる。
if [ "$(id -u)" -eq 0 ]; then
  if [ -d /data ]; then
    chown -R 1001:1001 /data 2>/dev/null || true
  fi
  # gosu は HOME を引き継がないため明示する (opencode 等が ~/.local/share を
  # /root 配下に作らないよう /home/app を渡す)。
  export HOME=/home/app
  exec gosu app "$0" "$@"
fi

# ここから先は app (UID 1001) として実行される
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

# node_modules は scaffold image のものをシンボリックリンクで参照する。
# ・Volume を汚さない (所有権問題が原理的に発生しない)
# ・起動が高速 (cp -r 数十秒 → リンク作成だけ)
# ・vite の .vite/deps/ キャッシュは image overlay に書かれ、毎 deploy で fresh になる
SCAFFOLD_LOCK="/app/container/scaffold/package-lock.json"
WORKSPACE_LOCK="$WORKSPACE_DIR/package-lock.json"
SCAFFOLD_NODE_MODULES="/app/container/scaffold/node_modules"

# 旧版互換 (実ディレクトリ → シンボリックリンクへの一回限りの移行)
if [ -d "$WORKSPACE_DIR/node_modules" ] && [ ! -L "$WORKSPACE_DIR/node_modules" ]; then
  echo "Migrating node_modules from real dir to symlink..."
  # 冒頭の root chown で app 所有になっているはずなので通常は成功する。
  if ! rm -rf "$WORKSPACE_DIR/node_modules" 2>/dev/null; then
    echo "ERROR: cannot remove $WORKSPACE_DIR/node_modules even after the boot chown."
    echo "       Volume may be corrupt; inspect with: flyctl ssh console -a ai-web-builder"
    exit 1
  fi
fi

# シンボリックリンク作成 (idempotent)
if [ ! -L "$WORKSPACE_DIR/node_modules" ]; then
  ln -sfn "$SCAFFOLD_NODE_MODULES" "$WORKSPACE_DIR/node_modules"
  echo "Linked node_modules → $SCAFFOLD_NODE_MODULES"
fi

# workspace の package-lock を scaffold と揃える (情報目的のみ — 解決はリンク経由)。
# 既存ファイルが root 所有だと書き換え失敗するが致命的ではないので fail-soft。
cp "$SCAFFOLD_LOCK" "$WORKSPACE_LOCK" 2>/dev/null || true

# 安全網: 冒頭の root chown が効いていれば workspace は全て UID 1001 のはず。
# 万一 1001 以外が残っていれば異常 (chown 失敗等) なので早期に警告して止める。
NON_APP_FILE=$(find "$WORKSPACE_DIR" -not -uid 1001 -print -quit 2>/dev/null || true)
if [ -n "$NON_APP_FILE" ]; then
  echo "ERROR: $WORKSPACE_DIR contains non-app-owned files (e.g. $NON_APP_FILE)"
  echo "       even after the root chown at boot. Volume may be corrupt;"
  echo "       inspect with: flyctl ssh console -a ai-web-builder"
  exit 1
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

# SECRETS_FILE を明示的に export し、postprocess 側のデフォルト解決と一致させる
export SECRETS_FILE="${SECRETS_FILE:-/data/secrets.json}"

# opencode.json の後処理: 共通 instructions / SITE_BRIEF の絶対パス注入 + secretsStore 経由のキー注入
node /app/container/opencode-postprocess.mjs \
  "$WORKSPACE_DIR/opencode.json" \
  "--common=/app/container/instructions/common.md" \
  "--site-brief=${WORKSPACE_DIR}/SITE_BRIEF.md" \
  "--from-secrets"

# Vite のキャッシュクリア（NODE_ENV 変更時に必要）。symlink 経由なので
# 実体は /app/container/scaffold/node_modules/.vite (image overlay 内)。
rm -rf "$WORKSPACE_DIR/node_modules/.vite" 2>/dev/null || true

# Vite Dev Server (ゲストサイト) — development モードで起動、base=/preview/
# プレーンテキスト出力を jsonl-wrap.mjs で JSON Lines ({ts,level,service,msg}) に
# 整形してから Fly stdout と $LOGS_DIR/vite.log の両方に流す。
# これで log-reader MCP の read_log(service="vite", level=...) がレベル別に引ける。
(cd "$WORKSPACE_DIR" && NODE_ENV=development VITE_BASE_PATH=/preview/ npx vite --host 0.0.0.0 --port 5173 2>&1 | node /app/container/jsonl-wrap.mjs vite | tee -a "$LOGS_DIR/vite.log") &

# Hono Dev Server (バックエンド API) — 同様に JSON Lines 化してから流す
(cd "$WORKSPACE_DIR" && npx tsx watch functions/api/index.ts 2>&1 | node /app/container/jsonl-wrap.mjs hono | tee -a "$LOGS_DIR/hono.log") &

# OpenCode serve は agent-server の supervisor が起動・監視するため start.sh では起動しない。
# (BYOK でキー更新時に再起動する必要があるため、child reference を agent-server が保持する)

# Agent Server (メインプロセス — フォアグラウンド)
# NODE_ENV=production はこのプロセスにだけ付与する (本番認証の有効化用)。
# コンテナ全体には焼かない (Dockerfile から ENV NODE_ENV=production を撤去済み)。
# opencode child へは supervisor の buildSanitizedEnv() が NODE_ENV=development に
# 上書きして渡すため、ゲストの npm install に production が漏れない。
#
# tee は付けない。agent-server.log は logger.ts の appendFileSync が JSON Lines を
# 直接書く。tee を噛ませると (1) 同じ行がファイルに二重に書かれ、(2) supervisor が
# Fly stdout へ転送する opencode のプレーンテキストまで agent-server.log に混入し、
# read_log/jq でのパースが壊れる。stdout は exec でそのまま Fly に渡す。
cd /app/container/agent-server && NODE_ENV=production exec npx tsx src/index.ts 2>&1

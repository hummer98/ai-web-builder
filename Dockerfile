FROM node:22-slim

# システム依存
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*
RUN npm i -g tsx npm-run-all2 firebase-tools

# OpenCode CLI (Go バイナリ)
RUN curl -fsSL https://opencode.ai/install | bash && \
    find /root -name opencode -type f 2>/dev/null | head -1 | xargs -I{} cp {} /usr/local/bin/opencode

# Playwright MCP + Chromium（AI 視覚フィードバック用）
# 非 root 切替後に app ユーザーから browser が読める場所にインストール (T014)
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright
RUN npm i -g @playwright/mcp && \
    PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright npx playwright install --with-deps chromium && \
    chmod -R a+rX /usr/local/share/playwright

# Nano Banana MCP（AI 画像生成用）
RUN npm i -g nano-banana-mcp

# 非 root ユーザー作成 (UID 1001 で /data Fly Volume と整合させる)
RUN groupadd -r app -g 1001 && \
    useradd -r -g app -u 1001 -m -d /home/app app

WORKDIR /app

# ルート依存
COPY package.json package-lock.json ./
RUN npm install

# Agent Server 依存
COPY container/agent-server/package.json container/agent-server/package-lock.json container/agent-server/
RUN cd container/agent-server && npm install

# Log Reader MCP 依存
COPY container/log-reader-mcp/package.json container/log-reader-mcp/package-lock.json container/log-reader-mcp/
RUN cd container/log-reader-mcp && npm install

# Editor UI ビルド
COPY editor/package.json editor/package-lock.json editor/
RUN cd editor && npm install
COPY editor/ editor/
RUN cd editor && npx vite build

# ビルダー共通 instructions（AGENTS.md にマージされる md ファイル）
COPY container/instructions/ container/instructions/

# opencode.json 後処理スクリプト（start.sh / site-init.ts 両方から利用）
COPY container/opencode-postprocess.mjs container/opencode-postprocess.mjs
COPY container/secrets-reader.mjs container/secrets-reader.mjs

# Scaffold の依存を事前インストール（新規サイト作成時にコピーされる）
COPY container/scaffold/ container/scaffold/
RUN cd container/scaffold && npm install

# 残りのソースコード
COPY container/agent-server/ container/agent-server/
COPY container/log-reader-mcp/ container/log-reader-mcp/

# ログディレクトリ + Fly Volume マウントポイント
RUN mkdir -p /app/logs /data && \
    chown -R app:app /app /data /home/app

EXPOSE 8080

# workspace は Fly Volume にマウントされる (/data/workspace)
ENV WORKSPACE_DIR=/data/workspace
ENV NODE_ENV=production

# サイト設定は Fly Secret SITES_JSON 経由で読み込む (start.sh 内で展開)

# 起動スクリプト
COPY container/start.sh /app/start.sh
RUN chmod +x /app/start.sh && chown app:app /app/start.sh

# 通常は USER app (UID 1001) で起動。
# Volume の所有権リカバリ時のみ build-arg で root 起動を許可する:
#   flyctl deploy --build-arg RUN_AS_USER=root
# 起動後 start.sh 冒頭の `chown -R 1001:1001 /data` が走り、終わったら build-arg
# 無しで再 deploy して app に戻す。
ARG RUN_AS_USER=app
USER ${RUN_AS_USER}

CMD ["/app/start.sh"]

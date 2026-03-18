FROM node:22-slim

# システム依存
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*
RUN npm i -g tsx npm-run-all2

# OpenCode CLI (Go バイナリ)
RUN curl -fsSL https://opencode.ai/install | bash && \
    find /root -name opencode -type f 2>/dev/null | head -1 | xargs -I{} cp {} /usr/local/bin/opencode

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

# Scaffold の依存を事前インストール（新規サイト作成時にコピーされる）
COPY container/scaffold/ container/scaffold/
RUN cd container/scaffold && npm install

# 残りのソースコード
COPY container/agent-server/ container/agent-server/
COPY container/log-reader-mcp/ container/log-reader-mcp/

# ログディレクトリ
RUN mkdir -p /app/logs

EXPOSE 8080

# workspace は Fly Volume にマウントされる (/data/workspace)
ENV WORKSPACE_DIR=/data/workspace
ENV NODE_ENV=production

# サイト設定
COPY sites.json /app/sites.json

# 起動スクリプト
COPY container/start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]

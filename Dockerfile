FROM node:22-slim

# OpenCode CLI
RUN npm i -g opencode tsx npm-run-all2

# Playwright headless Chromium (Phase 4 で使用)
# RUN npx playwright install --with-deps chromium

WORKDIR /app

# ビルダーツール本体の依存
COPY package.json ./
COPY container/agent-server/package.json container/agent-server/
RUN npm install --workspaces=false && cd container/agent-server && npm install

# Scaffold の依存を事前インストール
COPY container/scaffold/ /app/container/scaffold/
RUN cd /app/container/scaffold && npm install

# ソースコードをコピー
COPY . .

EXPOSE 8080 4096 5173 3000

# workspace は Fly Volume にマウントされる (/data/workspace)
ENV WORKSPACE_DIR=/data/workspace

CMD ["npm", "run", "dev"]

# Image de développement partagée par l'API et le front (docker-compose.yml).
FROM node:26-alpine
RUN npm install -g pnpm@10.34.9
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

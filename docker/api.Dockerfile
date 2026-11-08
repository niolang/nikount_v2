# API de production : build complet puis image minimale avec les seules dépendances de prod.
FROM node:26-alpine AS build
RUN npm install -g pnpm@10.34.9
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# Compile l'API et les paquets dont elle dépend, puis isole ses dépendances de production.
RUN pnpm --filter "@nikount/api..." build \
 && pnpm --filter @nikount/api deploy --prod --legacy /out

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

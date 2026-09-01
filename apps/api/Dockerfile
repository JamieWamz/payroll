# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS base
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

FROM base AS dependencies
ENV NODE_ENV=development
RUN npm ci

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm run build --workspace @zampayroll/api

FROM dependencies AS migrate
ENV NODE_ENV=production \
    TZ=UTC
COPY apps/api/migrations ./apps/api/migrations
WORKDIR /workspace/apps/api
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:24.18.0-bookworm-slim AS api
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=UTC
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @zampayroll/api \
  && npm cache clean --force

COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist

WORKDIR /workspace/apps/api
USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "dist/server.js"]

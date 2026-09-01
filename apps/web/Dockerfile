# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web
RUN npm run build --workspace @zampayroll/web

FROM nginx:1.29.1-alpine AS web
COPY apps/web/docker/nginx.conf /etc/nginx/nginx.conf
COPY apps/web/docker/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["wget", "--quiet", "--output-document=-", "http://127.0.0.1:8080/health"]

CMD ["nginx", "-g", "daemon off;"]

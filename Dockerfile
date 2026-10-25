FROM node:24.15.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NX_DAEMON=false

RUN corepack enable && corepack prepare pnpm@12.15.0 --activate

FROM base AS deps

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN HUSKY=0 pnpm install --frozen-lockfile

FROM deps AS workspace

COPY . .

FROM workspace AS database-init

CMD ["pnpm", "nx", "run", "backend-shared:db-migrate", "--output-style=static"]

FROM workspace AS build

RUN pnpm nx build web-api

FROM base AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=build /workspace/dist/apps/web/api ./dist/apps/web/api

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? '8080') + '/').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/apps/web/api/main.js"]

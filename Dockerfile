FROM node:24.15.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NX_DAEMON=false

RUN corepack enable && corepack prepare pnpm@12.15.0 --activate

FROM base AS deps

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

RUN HUSKY=0 pnpm install --frozen-lockfile

FROM deps AS workspace

COPY . .

FROM workspace AS database-init

CMD ["pnpm", "nx", "run", "backend-shared:db-migrate", "--output-style=static"]

FROM workspace AS build

ARG APP_NAME=web-gateway

RUN case "$APP_NAME" in \
      web-api) printf '%s\n' 'dist/apps/web/api/main.js' > app-entrypoint ;; \
      web-gateway) printf '%s\n' 'dist/apps/web/gateway/main.js' > app-entrypoint ;; \
      *) exit 1 ;; \
    esac \
    && pnpm nx build "$APP_NAME"

# Test-only tooling supplies local exporters; the compiled executable still owns startup.
FROM build AS test-runtime

ARG APP_NAME=web-gateway

ENV APP_NAME=${APP_NAME}

CMD ["sh", "-c", "exec node \"$(cat app-entrypoint)\""]

FROM base AS runtime

ARG APP_NAME=web-gateway

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV APP_NAME=${APP_NAME}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=build /workspace/dist/apps/web ./dist/apps/web
COPY --from=build /workspace/app-entrypoint ./app-entrypoint

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? '8080') + (process.env.APP_NAME === 'web-gateway' ? '/api/' : '/')).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["sh", "-c", "exec node \"$(cat app-entrypoint)\""]

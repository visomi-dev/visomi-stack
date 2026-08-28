FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NX_DAEMON=false

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

FROM base AS deps

WORKDIR /workspace

COPY package.json pnpm-lock.yaml nx.json tsconfig.base.json pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

FROM deps AS build

WORKDIR /workspace

COPY . .

RUN pnpm nx run-many -t build --projects server,realtime,worker,api,app,site --configuration production

FROM base AS runtime-base

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /workspace/dist ./dist
COPY --from=build /workspace/drizzle ./drizzle
COPY --from=build /workspace/dist/apps/web/app ./dist/apps/web/app
COPY --from=build /workspace/dist/apps/web/api ./dist/apps/web/api
COPY --from=build /workspace/dist/apps/web/realtime ./dist/apps/web/realtime
COPY --from=build /workspace/dist/apps/web/site ./dist/apps/web/site
COPY --from=build /workspace/dist/apps/worker ./dist/apps/worker

FROM runtime-base AS server-runtime

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "const port = process.env.PORT ?? process.env.GATEWAY_PORT ?? '8080'; fetch('http://127.0.0.1:' + port + '/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/apps/web/server/main.js"]

FROM server-runtime AS runtime

FROM node:24.5.0-alpine3.22 AS builder

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/preview-edge/package.json ./packages/preview-edge/package.json

RUN pnpm install --frozen-lockfile --filter @blame/preview-edge...

COPY packages/preview-edge/tsconfig.json ./packages/preview-edge/tsconfig.json
COPY packages/preview-edge/src ./packages/preview-edge/src

RUN pnpm --filter @blame/preview-edge build

FROM node:24.5.0-alpine3.22 AS production

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY --from=builder --chown=node:node /workspace/packages/preview-edge/package.json ./package.json
COPY --from=builder --chown=node:node /workspace/packages/preview-edge/dist ./dist

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT||'8080';fetch(`http://127.0.0.1:${port}/healthz`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM

CMD ["node", "dist/server.js"]

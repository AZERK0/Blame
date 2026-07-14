# =============================================================================
# Dockerfile for @blame/api (AdonisJS)
# =============================================================================

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base

# Install pnpm matching project version
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /app

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS builder

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy packages (shared code)
COPY packages/ ./packages/

# Copy the backend source
COPY packages/api/ ./packages/api/

# Install dependencies
RUN pnpm install

# Increase memory limit for the build process
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Build the backend
RUN pnpm --filter @blame/api... build

# -----------------------------------------------------------------------------
# Production stage
# -----------------------------------------------------------------------------
FROM node:22-alpine AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
RUN apk add --no-cache fontconfig ttf-dejavu ttf-liberation font-noto \
    && fc-cache -f

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 adonis

# Copy workspace configuration
COPY --chown=adonis:nodejs pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy packages (needed for workspace dependency)
COPY --from=builder --chown=adonis:nodejs /app/packages ./packages

# Copy built application to its specific folder in apps/
COPY --from=builder --chown=adonis:nodejs /app/packages/api/build ./packages/api

# Install production dependencies for the workspace
RUN pnpm install --prod --filter @blame/api...

USER adonis

# Set working directory to the backend app
WORKDIR /app/packages/api

EXPOSE 3333

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3333
ENV TZ=UTC
ENV ACCOUNT_CLOSURE_LEDGER_DIRECTORY=/var/lib/blame/account-closure-ledger

CMD ["node", "bin/server.js"]

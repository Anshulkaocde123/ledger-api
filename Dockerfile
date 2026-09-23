# ==============================================================================
# Multi-stage Dockerfile for ledger-api
# Stage 1: Build stage (installs dependencies, compiles native addons)
# Stage 2: Production runtime stage (minimal footprint, non-root user, slim image)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Dependencies & Build
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Install build essentials required for native C++ addons (e.g. bcrypt)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency manifests first to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies if needed for build/lint)
RUN npm ci

# Copy application source code, migrations, and public workbench assets
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY public/ ./public/

# Prune non-production dependencies to leave only production node_modules
RUN npm prune --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 2: Slim Production Runtime Image
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

# Install dumb-init for proper PID 1 signal forwarding (SIGTERM / SIGINT)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Set production environment
ENV NODE_ENV=production \
    PORT=3000

# Copy only production artifacts and node_modules from the builder stage
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/migrations ./migrations
COPY --from=builder --chown=node:node /app/public ./public

# Security: Run container as non-root unprivileged 'node' user
USER node

# Expose HTTP API port
EXPOSE 3000

# Container healthcheck targeting the service health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

# Launch application via dumb-init for graceful shutdown signal handling
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]

# T1-L0-FE: the frontend container, as the local stack builds it (backend repository, docs/2026-11-23-local-stack.md,
# section 3) and as Container Apps will run it later. Next's standalone server on port 3000, all interfaces.
#
#   docker build -t beacon-frontend --build-arg NEXT_PUBLIC_AUTH_API_URL=https://beaconculinary.pos.localhost/api .
#   docker run --rm -p 3000:3000 beacon-frontend
#
# Build arguments:
#   NEXT_PUBLIC_AUTH_API_URL  required until T1-0d: the API address, inlined into the client code at build time.
#   POS_APP_BUILD_ID          optional: the build id (heartbeat appVersion, service-worker cache version). When empty,
#                             next.config.mjs makes one ("<version>-nogit-<time>": .git isn't in the build context).
# See docs/2026-11-23-frontend-container.md.

ARG NODE_IMAGE=node:20.19.6-bookworm-slim

# 1. Dependencies, from the lock file only: this layer is reused until package.json or package-lock.json changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. The build: next build (standalone output) and the POS service worker (public/sw.js).
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_AUTH_API_URL
ARG POS_APP_BUILD_ID
# An empty argument would still be set (as ""), so both are checked here: the API address must be given (the app's
# fallback, localhost:8080, means nothing inside a container), and an empty build id is removed so that
# next.config.mjs makes one.
RUN if [ -z "$NEXT_PUBLIC_AUTH_API_URL" ]; then \
      echo "NEXT_PUBLIC_AUTH_API_URL is required, e.g. --build-arg NEXT_PUBLIC_AUTH_API_URL=https://beaconculinary.pos.localhost/api" >&2; \
      exit 1; \
    fi; \
    if [ -z "$POS_APP_BUILD_ID" ]; then unset POS_APP_BUILD_ID; fi; \
    npm run build

# 3. The running image: only the standalone server, its static files and public/ (as deploy.ps1 packages them).
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# Node's own fetch: the slim image has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/pos/login').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]

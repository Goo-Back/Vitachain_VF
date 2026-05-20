# syntax=docker/dockerfile:1.7
# =============================================================================
# VitaChain frontend (INF-03) — multi-stage build, standalone Next.js runtime.
# Behind NGINX (INF-01); only port 3000 exposed on vita_net, never on the host.
# =============================================================================

ARG NODE_VERSION=20-alpine

# ---- 1. deps ----------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Install with the lockfile if present; fall back to npm install on first build.
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      echo ">>> no package-lock.json yet — running npm install (commit the lockfile after first build)"; \
      npm install --no-audit --no-fund; \
    fi

# ---- 2. build ---------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public envs MUST be present at build time — Next.js inlines them into the JS
# bundle. Compose passes these as build args from /opt/vitachain/.env.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN npm run build

# ---- 3. runtime -------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# `output: "standalone"` produces the minimal server.js + only needed node_modules.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]

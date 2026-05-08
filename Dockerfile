# Build stage : installe les deps avec un cache stable
FROM node:20-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Production stage
FROM node:20-alpine

# tini pour PID 1 propre (signaux SIGTERM/SIGINT propagés au process Node)
RUN apk add --no-cache tini

WORKDIR /app

# Récupère les node_modules figés depuis le builder
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

# Volumes persistants (queue.sqlite + logs)
RUN mkdir -p /app/data /app/logs && chown -R node:node /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3500

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]

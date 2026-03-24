FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY src/ ./src/

RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs

EXPOSE 3500

USER node

CMD ["node", "src/app.js"]

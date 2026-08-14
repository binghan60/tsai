FROM node:22-bookworm-slim AS client-builder

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build


FROM node:22-bookworm-slim AS server-dependencies

ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_NO_SANDBOX=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-noto-color-emoji dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY --from=server-dependencies --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server/package.json ./package.json
COPY --chown=node:node server/src ./src
COPY --from=client-builder --chown=node:node /app/client/dist /app/client/dist

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]

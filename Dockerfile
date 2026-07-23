# Build frontend
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: Node + Python + curl_cffi
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/local/bin/python \
    && ln -sf /usr/bin/python3 /usr/bin/python

# production node deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=build /app/dist ./dist

# curl_cffi for scrape + media worker
RUN pip3 install --no-cache-dir --break-system-packages curl_cffi || \
    pip3 install --no-cache-dir curl_cffi

ENV NODE_ENV=production \
    PORT=8787 \
    CACHE_DIR=/app/.cache/aether \
    AUTH_SECURE_COOKIE=1

RUN mkdir -p /app/.cache/aether
EXPOSE 8787
CMD ["node", "server/index.js"]

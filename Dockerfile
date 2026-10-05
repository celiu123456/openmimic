# OpenMimic — single-container build + serve.
# The server runs TypeScript directly via tsx; the frontend is built by Vite.
#
# Build: docker build -t openmimic .
# Run:   docker run -p 7860:7860 -v openmimic-data:/app/data \
#          -e OPENMIMIC_ADMIN_TOKEN=your-secret \
#          -e LLM_BASE_URL=https://api.example.com/v1 \
#          -e LLM_API_KEY=sk-xxx \
#          -e LLM_MODEL=your-model \
#          openmimic

FROM node:22-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci

# --- build web ---
FROM deps AS web-build
COPY . .
RUN npm run build:web

# --- production image ---
FROM base AS production
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci
# web dist
COPY --from=web-build /app/web/dist web/dist
# server + kernel + engines + plugins + shared + fixtures
COPY kernel/ kernel/
COPY engines/ engines/
COPY plugins/ plugins/
COPY packages/ packages/
COPY server/ server/
COPY shared/ shared/
COPY fixtures/ fixtures/
COPY openmimic.yml .
COPY tsconfig.json .

EXPOSE 7860
ENV NODE_ENV=production
ENV PORT=7860
VOLUME ["/app/data"]

CMD ["npx", "tsx", "server/src/main.ts"]

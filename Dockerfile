# =============================================================
# Stage 1: Builder
# =============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# tzdata — timezone uchun
RUN apk add --no-cache tzdata

# Dependencies
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Source code
COPY . .

# Prisma generate + TypeScript build
RUN npx prisma generate
RUN npm run build

# Production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# =============================================================
# Stage 2: Runtime
# =============================================================
FROM node:20-alpine AS runtime

WORKDIR /app

# Timezone setup
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Tashkent /etc/localtime && \
    echo "Asia/Tashkent" > /etc/timezone && \
    apk del tzdata

# Non-root user (security)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

ENV NODE_ENV=production
ENV TZ=Asia/Tashkent

# Built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

USER nodejs

# Healthcheck (optional)
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]

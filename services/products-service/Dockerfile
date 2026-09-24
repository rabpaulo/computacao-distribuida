# ===================================================
# Estágio 1: Build (TypeScript Compilation)
# ===================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# ===================================================
# Estágio 2: Runtime de Produção (Leve e Seguro)
# ===================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3002

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

CMD ["node", "dist/server.js"]

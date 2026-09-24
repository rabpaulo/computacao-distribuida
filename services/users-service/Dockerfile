# ===================================================
# Estágio 1: Build (TypeScript Compilation)
# ===================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependências necessárias para compilação
COPY package*.json tsconfig.json ./
RUN npm install

# Copiar código fonte e compilar
COPY src/ ./src/
RUN npm run build

# ===================================================
# Estágio 2: Runtime de Produção (Leve e Seguro)
# ===================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copiar arquivos de dependências e instalar somente dependências de produção
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copiar código JavaScript transpilado
COPY --from=builder /app/dist ./dist

# Utilizar usuário não-root por segurança
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]

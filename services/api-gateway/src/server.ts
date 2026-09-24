import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { env } from './config/env';

const app = express();

// Middlewares de segurança e auditoria
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(morgan('dev'));

// ============================================================================
// Probes e Status dos Nós Distribuídos
// ============================================================================
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/services', async (_req, res) => {
  const checkService = async (name: string, url: string) => {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      return { name, url, status: response.ok ? 'ONLINE' : 'DEGRADED', data };
    } catch (err: any) {
      return { name, url, status: 'OFFLINE', error: err.message };
    }
  };

  const results = await Promise.all([
    checkService('users-service', env.USERS_SERVICE_URL),
    checkService('products-service', env.PRODUCTS_SERVICE_URL),
    checkService('orders-service', env.ORDERS_SERVICE_URL),
  ]);

  const allOnline = results.every((s) => s.status === 'ONLINE');

  res.status(allOnline ? 200 : 207).json({
    gateway: 'ONLINE',
    timestamp: new Date().toISOString(),
    services: results,
  });
});

// ============================================================================
// Roteamento Reverso para Microsserviços Distribuídos
// (Montado antes de express.json() para streaming de payload transparente)
// ============================================================================

// 1. Roteamento de Autenticação e Usuários -> users-service (3001)
app.use(
  createProxyMiddleware({
    target: env.USERS_SERVICE_URL,
    changeOrigin: true,
    pathFilter: ['/api/v1/auth', '/api/v1/users'],
    logger: console,
  })
);

// 2. Roteamento do Catálogo de Produtos -> products-service (3002)
app.use(
  createProxyMiddleware({
    target: env.PRODUCTS_SERVICE_URL,
    changeOrigin: true,
    pathFilter: '/api/v1/products',
    logger: console,
  })
);

// 3. Roteamento de Pedidos e Checkout -> orders-service (3003)
app.use(
  createProxyMiddleware({
    target: env.ORDERS_SERVICE_URL,
    changeOrigin: true,
    pathFilter: '/api/v1/orders',
    logger: console,
  })
);

// Middleware para parsing de rotas próprias do gateway
app.use(express.json());

// 404 Handler
app.use('*', (_req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Rota não encontrada no API Gateway do DistriCommerce',
  });
});

const server = app.listen(env.PORT, () => {
  console.log(`[api-gateway] Gateway rodando na porta ${env.PORT}`);
  console.log(`[api-gateway] Proxy: Users -> ${env.USERS_SERVICE_URL}`);
  console.log(`[api-gateway] Proxy: Products -> ${env.PRODUCTS_SERVICE_URL}`);
  console.log(`[api-gateway] Proxy: Orders -> ${env.ORDERS_SERVICE_URL}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

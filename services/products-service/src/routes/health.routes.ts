import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';

const router = Router();

// Liveness probe para o Kubernetes (indica se o processo está vivo)
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    service: 'products-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness probe para o Kubernetes (indica se a conexão com MongoDB está estabelecida)
router.get('/ready', (_req: Request, res: Response) => {
  const isHealthy = checkDatabaseHealth();

  if (!isHealthy) {
    res.status(503).json({
      status: 'DOWN',
      service: 'products-service',
      database: 'DISCONNECTED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: 'READY',
    service: 'products-service',
    database: 'CONNECTED',
    timestamp: new Date().toISOString(),
  });
});

export default router;

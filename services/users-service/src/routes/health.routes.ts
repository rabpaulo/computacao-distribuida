import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';

const router = Router();

// Liveness probe para o Kubernetes (indica se a aplicação está de pé)
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    service: 'users-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness probe para o Kubernetes (indica se está pronto para receber tráfego)
router.get('/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();

  if (!dbHealthy) {
    res.status(503).json({
      status: 'DOWN',
      service: 'users-service',
      database: 'DISCONNECTED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: 'READY',
    service: 'users-service',
    database: 'CONNECTED',
    timestamp: new Date().toISOString(),
  });
});

export default router;

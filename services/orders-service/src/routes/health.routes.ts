import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    service: 'orders-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get('/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();

  if (!dbHealthy) {
    res.status(503).json({
      status: 'DOWN',
      service: 'orders-service',
      database: 'DISCONNECTED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: 'READY',
    service: 'orders-service',
    database: 'CONNECTED',
    timestamp: new Date().toISOString(),
  });
});

export default router;

import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';
import { broker } from '../messaging';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    service: 'payments-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get('/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();
  const brokerHealthy = broker.isHealthy();

  // Sem fila esse servico nao faz nada, entao broker fora = DOWN mesmo
  if (!dbHealthy || !brokerHealthy) {
    res.status(503).json({
      status: 'DOWN',
      service: 'payments-service',
      database: dbHealthy ? 'CONNECTED' : 'DISCONNECTED',
      messaging: brokerHealthy ? 'CONNECTED' : 'DISCONNECTED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: 'READY',
    service: 'payments-service',
    database: 'CONNECTED',
    messaging: 'CONNECTED',
    timestamp: new Date().toISOString(),
  });
});

export default router;

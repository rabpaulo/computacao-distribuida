import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';
import { hub } from '../container';
import { broker } from '../messaging';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    service: 'notifications-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sseConnections: hub.connectionCount(),
  });
});

router.get('/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();
  const brokerHealthy = broker.isHealthy();

  const body = {
    service: 'notifications-service',
    database: dbHealthy ? 'CONNECTED' : 'DISCONNECTED',
    messaging: brokerHealthy ? 'CONNECTED' : 'DISCONNECTED',
    timestamp: new Date().toISOString(),
  };

  if (!dbHealthy) {
    res.status(503).json({ status: 'DOWN', ...body });
    return;
  }

  // Sem RabbitMQ não nascem notificações novas, mas a lista continua funcionando
  res.status(brokerHealthy ? 200 : 207).json({
    status: brokerHealthy ? 'READY' : 'DEGRADED',
    ...body,
  });
});

export default router;

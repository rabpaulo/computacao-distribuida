import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';
import { broker } from '../messaging';
import { fleet } from '../container';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    service: 'logistics-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    trucksOnline: fleet.onlineTrucks().length,
  });
});

router.get('/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();
  const brokerHealthy = broker.isHealthy();
  const mqttHealthy = fleet.isHealthy();

  const body = {
    service: 'logistics-service',
    database: dbHealthy ? 'CONNECTED' : 'DISCONNECTED',
    messaging: brokerHealthy ? 'CONNECTED' : 'DISCONNECTED',
    mqtt: mqttHealthy ? 'CONNECTED' : 'DISCONNECTED',
    timestamp: new Date().toISOString(),
  };

  if (!dbHealthy) {
    res.status(503).json({ status: 'DOWN', ...body });
    return;
  }

  // Sem RabbitMQ nao entram entregas novas; sem MQTT nao ha rastreamento.
  // Consultas continuam funcionando, entao e DEGRADED e nao DOWN.
  const ok = brokerHealthy && mqttHealthy;
  res.status(ok ? 200 : 207).json({ status: ok ? 'READY' : 'DEGRADED', ...body });
});

export default router;

import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

// Métricas Prometheus do serviço (RED: Rate, Errors, Duration).
// Módulo singleton: createApp() pode ser chamado várias vezes (testes) sem registrar duas vezes.
const SERVICE_NAME = process.env.SERVICE_NAME || 'payments-service';

client.register.setDefaultLabels({ service: SERVICE_NAME });
client.collectDefaultMetrics();

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP',
  labelNames: ['method', 'route', 'status_code'] as const,
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latência das requisições HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Requisições HTTP em andamento',
});

// Troca IDs (numéricos, UUID, ObjectId) por :id para não explodir a cardinalidade dos labels.
function normalizePath(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{24}$/i.test(seg) || /^[0-9a-f-]{36}$/i.test(seg) ? ':id' : seg
    )
    .join('/');
}

function routeLabel(req: Request, statusCode: number): string {
  if (req.route?.path) return `${req.baseUrl}${req.route.path}`;
  if (statusCode === 404) return 'unmatched';
  return normalizePath(req.originalUrl.split('?')[0]);
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/metrics') {
    next();
    return;
  }
  const end = httpRequestDuration.startTimer();
  httpRequestsInFlight.inc();
  res.on('finish', () => {
    httpRequestsInFlight.dec();
    const labels = {
      method: req.method,
      route: routeLabel(req, res.statusCode),
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}

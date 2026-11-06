import { createApp, ChaosMode } from './app';

const port = Number(process.env.PORT ?? 3006);

const app = createApp({
  clientId: process.env.PAYPAL_CLIENT_ID ?? 'districommerce-sandbox-client',
  clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? 'districommerce-sandbox-secret',
  latencyMs: Number(process.env.PAYPAL_LATENCY_MS ?? 800),
  failureRate: Number(process.env.PAYPAL_FAILURE_RATE ?? 0.1),
  mode: (process.env.PAYPAL_CHAOS_MODE as ChaosMode) ?? 'normal',
  slowLatencyMs: Number(process.env.PAYPAL_SLOW_LATENCY_MS ?? 10000),
});

const server = app.listen(port, () => {
  console.log(`[paypal-mock] Simulador PayPal (sandbox falso) rodando na porta ${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

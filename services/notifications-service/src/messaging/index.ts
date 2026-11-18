import { env } from '../config/env';
import { RabbitBroker } from './broker';

// Conexão única do notifications-service com o broker
export const broker = new RabbitBroker({
  url: env.RABBITMQ_URL,
  serviceName: 'notifications-service',
  prefetch: env.RABBITMQ_PREFETCH,
  maxRetries: env.RABBITMQ_MAX_RETRIES,
  retryDelayMs: env.RABBITMQ_RETRY_DELAY_MS,
});

export { EXCHANGES, QUEUES, ROUTING_KEYS } from './config';
export * from './events';

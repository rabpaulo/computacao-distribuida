import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3004),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_NAME: z.string().default('districommerce_users'),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('districommerce-users-secret-jwt-key-minimum-length'),

  // RabbitMQ
  RABBITMQ_URL: z.string().default('amqp://admin:admin@localhost:5672'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(5),
  RABBITMQ_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),

  // Como nao temos gateway de pagamento de verdade, simulamos um aqui.
  // Latencia artificial, so pra dar tempo de ver o pedido em PENDING
  PAYMENT_LATENCY_MS: z.coerce.number().int().nonnegative().default(2000),
  // Chance de falhar e cair no retry. Use 0 se quiser resultado previsivel
  PAYMENT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.3),
  // Acima disso o pagamento e recusado de vez, sem tentar de novo
  PAYMENT_MAX_AMOUNT: z.coerce.number().positive().default(50000),
});

export const env = envSchema.parse(process.env);

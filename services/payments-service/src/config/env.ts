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

  // Gateway PayPal simulado (services/paypal-mock imita a API REST v2).
  // Nada aqui fala com o PayPal de verdade.
  PAYPAL_BASE_URL: z.string().default('http://localhost:3006'),
  PAYPAL_CLIENT_ID: z.string().default('districommerce-sandbox-client'),
  PAYPAL_CLIENT_SECRET: z.string().default('districommerce-sandbox-secret'),
  PAYPAL_CURRENCY: z.string().length(3).default('BRL'),

  // Acima disso o pagamento e recusado de vez, sem tentar de novo
  PAYMENT_MAX_AMOUNT: z.coerce.number().positive().default(50000),

  // Circuit Breaker (vale para todas as dependencias HTTP do servico)
  CB_SLIDING_WINDOW_SIZE: z.coerce.number().int().positive().default(10),
  CB_MINIMUM_CALLS: z.coerce.number().int().positive().default(5),
  CB_FAILURE_RATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  CB_RESET_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CB_HALF_OPEN_MAX_CALLS: z.coerce.number().int().positive().default(2),
  CB_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export const env = envSchema.parse(process.env);

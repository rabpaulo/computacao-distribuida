import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3003),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_NAME: z.string().default('districommerce_users'),
  DATABASE_URL: z.string().optional(),
  PRODUCTS_SERVICE_URL: z.string().default('http://localhost:3002'),
  JWT_SECRET: z.string().min(16).default('districommerce-users-secret-jwt-key-minimum-length'),
  // RabbitMQ
  RABBITMQ_URL: z.string().default('amqp://admin:admin@localhost:5672'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
  RABBITMQ_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),

  // Circuit Breaker (vale para todas as dependencias HTTP do servico)
  CB_SLIDING_WINDOW_SIZE: z.coerce.number().int().positive().default(10),
  CB_MINIMUM_CALLS: z.coerce.number().int().positive().default(5),
  CB_FAILURE_RATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  CB_RESET_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CB_HALF_OPEN_MAX_CALLS: z.coerce.number().int().positive().default(2),
  CB_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export const env = envSchema.parse(process.env);

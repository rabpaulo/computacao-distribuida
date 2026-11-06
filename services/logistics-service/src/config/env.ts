import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3005),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_NAME: z.string().default('districommerce_users'),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('districommerce-users-secret-jwt-key-minimum-length'),

  // RabbitMQ (recebe order.confirmed)
  RABBITMQ_URL: z.string().default('amqp://admin:admin@localhost:5672'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
  RABBITMQ_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),

  // MQTT (fala com os caminhoes)
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  // Shared subscription ($share/<grupo>/...) para dividir telemetria entre
  // replicas. Vazio desliga (broker sem suporte).
  MQTT_SHARED_GROUP: z.string().default('logistics'),

  // Centro de distribuicao de onde saem as entregas (Sao Paulo por padrao)
  WAREHOUSE_LAT: z.coerce.number().default(-23.5614),
  WAREHOUSE_LNG: z.coerce.number().default(-46.6559),
  // Acima disso o sensor do bau gera alerta
  CARGO_TEMP_ALERT_C: z.coerce.number().default(30),
});

export const env = envSchema.parse(process.env);

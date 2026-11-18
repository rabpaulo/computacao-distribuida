import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3007),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_NAME: z.string().default('districommerce_users'),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('districommerce-users-secret-jwt-key-minimum-length'),

  // RabbitMQ (consome os eventos de pedido, pagamento, entrega e exclusão de conta)
  RABBITMQ_URL: z.string().default('amqp://admin:admin@localhost:5672'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
  RABBITMQ_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),

  // Tempo real (Server-Sent Events)
  // Comentário enviado de tempos em tempos para os proxies não derrubarem a conexão parada
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(20000),
  // Abas abertas por usuário; passou disso, a conexão mais antiga é encerrada
  SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().default(5),

  // LGPD (minimização): notificações mais antigas que isso são apagadas
  NOTIFICATIONS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

export const env = envSchema.parse(process.env);

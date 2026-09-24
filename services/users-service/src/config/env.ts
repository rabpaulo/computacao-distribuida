import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_NAME: z.string().default('districommerce_users'),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres').default('districommerce-users-secret-jwt-key-minimum-length'),
  JWT_EXPIRES_IN: z.string().default('24h')
});

export const env = envSchema.parse(process.env);

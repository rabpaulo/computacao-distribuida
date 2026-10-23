import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  USERS_SERVICE_URL: z.string().default('http://localhost:3001'),
  PRODUCTS_SERVICE_URL: z.string().default('http://localhost:3002'),
  ORDERS_SERVICE_URL: z.string().default('http://localhost:3003'),
  PAYMENTS_SERVICE_URL: z.string().default('http://localhost:3004'),
  CLIENT_ORIGIN: z.string().default('*'),
});

export const env = envSchema.parse(process.env);

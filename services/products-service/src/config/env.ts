import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().default('mongodb://root:rootpassword@localhost:27017/districommerce_products?authSource=admin'),
  JWT_SECRET: z.string().min(16).default('districommerce-users-secret-jwt-key-minimum-length'),
});

export const env = envSchema.parse(process.env);

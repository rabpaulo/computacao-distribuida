import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

export async function initDatabase(): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(190) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'ROLE_CUSTOMER',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `;

  await pool.query(query);
  console.log('[users-service] Tabela "users" verificada/inicializada no PostgreSQL.');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[users-service] Falha de conexão com PostgreSQL:', error);
    return false;
  }
}

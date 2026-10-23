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
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

export async function initDatabase(): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      amount NUMERIC(10, 2) NOT NULL,
      status VARCHAR(20) NOT NULL,
      reason TEXT,
      attempts INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- E o indice unico que impede cobrar o mesmo pedido duas vezes quando
    -- o broker reentrega a mensagem
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
  `;

  await pool.query(query);
  console.log('[payments-service] Tabela "payments" inicializada.');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[payments-service] Conexão com banco falhou:', error);
    return false;
  }
}

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
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      total_amount NUMERIC(10, 2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id VARCHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id VARCHAR(50) NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      price NUMERIC(10, 2) NOT NULL,
      quantity INT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
  `;

  await pool.query(query);
  console.log('[orders-service] Tabelas "orders" e "order_items" inicializadas.');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[orders-service] Conexão com banco falhou:', error);
    return false;
  }
}

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
    CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      -- Id do evento que originou a notificação: reentrega do broker não duplica
      event_id VARCHAR(36) NOT NULL UNIQUE,
      type VARCHAR(40) NOT NULL,
      level VARCHAR(10) NOT NULL DEFAULT 'info',
      title VARCHAR(150) NOT NULL,
      message TEXT NOT NULL,
      order_id VARCHAR(36),
      read_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

    -- Os eventos de pagamento não trazem o userId. Guardamos quem é o dono de
    -- cada pedido (vindo de order.created) para saber a quem avisar.
    CREATE TABLE IF NOT EXISTS order_owners (
      order_id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_order_owners_user ON order_owners(user_id);
  `;

  await pool.query(query);
  console.log('[notifications-service] Tabelas "notifications" e "order_owners" inicializadas.');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[notifications-service] Conexão com banco falhou:', error);
    return false;
  }
}

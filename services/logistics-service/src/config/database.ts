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
    CREATE TABLE IF NOT EXISTS shipments (
      id VARCHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      status VARCHAR(20) NOT NULL,
      truck_id VARCHAR(40),
      origin_lat DOUBLE PRECISION NOT NULL,
      origin_lng DOUBLE PRECISION NOT NULL,
      dest_lat DOUBLE PRECISION NOT NULL,
      dest_lng DOUBLE PRECISION NOT NULL,
      current_lat DOUBLE PRECISION,
      current_lng DOUBLE PRECISION,
      progress DOUBLE PRECISION NOT NULL DEFAULT 0,
      speed_kmh DOUBLE PRECISION,
      cargo_temp_c DOUBLE PRECISION,
      eta_seconds INT,
      last_telemetry_at TIMESTAMP WITH TIME ZONE,
      delivered_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Uma entrega por pedido: order.confirmed reentregue nao duplica
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_user_id ON shipments(user_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_truck_status ON shipments(truck_id, status);

    CREATE TABLE IF NOT EXISTS shipment_events (
      id BIGSERIAL PRIMARY KEY,
      shipment_id VARCHAR(36) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      description TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_events(shipment_id);
  `;

  await pool.query(query);
  console.log('[logistics-service] Tabelas "shipments" e "shipment_events" inicializadas.');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[logistics-service] Conexão com banco falhou:', error);
    return false;
  }
}

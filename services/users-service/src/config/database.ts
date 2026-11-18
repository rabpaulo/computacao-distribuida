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

// O schema do banco é criado e evoluído pelo Flyway (infra/flyway/sql). Este
// serviço NÃO cria tabelas: só espera as migrations estarem aplicadas.
//
// Menor versão do schema de que este serviço depende (V1__usuarios.sql). Se uma migration
// futura mudar o que ele usa, é só subir este número: o serviço passa a recusar
// bancos que ainda não receberam a mudança.
export const REQUIRED_SCHEMA_VERSION = 1;

// Espera o Flyway terminar. No Docker Compose o serviço já sobe depois dele, mas
// no Kubernetes (ou rodando sem o compose) os dois podem iniciar juntos.
export async function waitForSchema(timeoutMs = 90_000, pollMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let reason = '';

  for (;;) {
    try {
      // A tabela de histórico do Flyway diz o que já foi aplicado com sucesso
      const result = await pool.query<{ version: number }>(
        `SELECT COALESCE(MAX(version::int), 0) AS version
         FROM flyway_schema_history
         WHERE success = true AND version IS NOT NULL`
      );
      const current = Number(result.rows[0]?.version ?? 0);

      if (current >= REQUIRED_SCHEMA_VERSION) {
        console.log(
          `[users-service] Schema na versão ${current} (mínima exigida: ${REQUIRED_SCHEMA_VERSION}).`
        );
        return;
      }
      reason = `schema na versão ${current}, mínima exigida ${REQUIRED_SCHEMA_VERSION}`;
    } catch (error) {
      // Banco ainda sem a tabela flyway_schema_history, ou fora do ar
      reason = (error as Error).message;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Schema do banco não está pronto (${reason}). Aplique as migrations: docker compose run --rm flyway`
      );
    }

    console.log(`[users-service] Aguardando as migrations do Flyway (${reason})...`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
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

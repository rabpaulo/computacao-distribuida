import { createApp } from './app';
import { env } from './config/env';
import { initDatabase, pool } from './config/database';

async function bootstrap() {
  try {
    console.log(`[orders-service] Inicializando serviço em ambiente: ${env.NODE_ENV}...`);

    await initDatabase();

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`[orders-service] Servidor rodando na porta ${env.PORT}`);
    });

    const gracefulShutdown = (signal: string) => {
      console.log(`[orders-service] Sinal ${signal} recebido. Encerrando conexões...`);
      server.close(async () => {
        try {
          await pool.end();
          console.log('[orders-service] Conexões fechadas com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('[orders-service] Erro ao fechar banco:', err);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error('[orders-service] Timeout de encerramento, forçando shutdown.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[orders-service] Erro fatal durante inicialização:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

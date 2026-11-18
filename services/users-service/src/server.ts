import { createApp } from './app';
import { env } from './config/env';
import { waitForSchema, pool } from './config/database';
import { publisher } from './messaging/publisher';

async function bootstrap() {
  try {
    console.log(`[users-service] Inicializando serviço em ambiente: ${env.NODE_ENV}...`);

    // O schema vem do Flyway: espera as migrations em vez de criar tabelas aqui
    await waitForSchema();

    // RabbitMQ conecta em background e reconecta sozinho. Só é usado na exclusão
    // de conta (user.deleted): login e cadastro funcionam mesmo com o broker fora.
    void publisher.connect();

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`[users-service] Servidor rodando com sucesso na porta ${env.PORT}`);
      console.log(`[users-service] Health check disponível em: http://localhost:${env.PORT}/health`);
    });

    // Tratamento de Graceful Shutdown (Padrão de Sistemas Distribuídos e Kubernetes)
    const gracefulShutdown = (signal: string) => {
      console.log(`[users-service] Sinal ${signal} recebido. Encerrando conexões de forma ordenada...`);
      server.close(async () => {
        console.log('[users-service] Servidor HTTP fechado.');
        try {
          await publisher.close();
          await pool.end();
          console.log('[users-service] Pool PostgreSQL desconectado com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('[users-service] Erro ao fechar pool PostgreSQL:', err);
          process.exit(1);
        }
      });

      // Forçar encerramento após timeout se travar
      setTimeout(() => {
        console.error('[users-service] Não foi possível encerrar a tempo, finalizando forçadamente.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[users-service] Erro fatal durante a inicialização:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

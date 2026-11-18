import { createApp } from './app';
import { env } from './config/env';
import { initDatabase, pool } from './config/database';
import { hub, notificationService } from './container';
import { broker } from './messaging';
import { registerEventConsumer } from './messaging/consumers';

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function bootstrap() {
  try {
    console.log(`[notifications-service] Inicializando serviço em ambiente: ${env.NODE_ENV}...`);

    await initDatabase();

    // O RabbitMQ conecta em background e reconecta sozinho
    void broker
      .connect()
      .then(() => registerEventConsumer(notificationService))
      .catch((err) => console.error('[notifications-service] Falha ao inicializar mensageria:', err));

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`[notifications-service] Servidor rodando na porta ${env.PORT}`);
    });

    // Mantém as conexões SSE vivas através dos proxies (gateway, nginx, Caddy)
    const heartbeat = setInterval(() => hub.heartbeat(), env.SSE_HEARTBEAT_MS);

    // LGPD (minimização): limpa notificações antigas ao subir e a cada 6 horas
    const purge = async () => {
      try {
        const removed = await notificationService.purgeOlderThan(env.NOTIFICATIONS_RETENTION_DAYS);
        if (removed > 0) {
          console.log(`[notifications-service] Retenção: ${removed} notificação(ões) antigas removidas.`);
        }
      } catch (err) {
        console.error('[notifications-service] Falha na limpeza por retenção:', err);
      }
    };
    void purge();
    const purgeTimer = setInterval(purge, PURGE_INTERVAL_MS);

    const gracefulShutdown = (signal: string) => {
      console.log(`[notifications-service] Sinal ${signal} recebido. Encerrando conexões...`);
      clearInterval(heartbeat);
      clearInterval(purgeTimer);
      // Sem fechar as conexões SSE, server.close() esperaria por elas indefinidamente
      hub.closeAll();

      server.close(async () => {
        try {
          await broker.close();
          await pool.end();
          console.log('[notifications-service] Conexões fechadas com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('[notifications-service] Erro ao fechar recursos:', err);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error('[notifications-service] Timeout de encerramento, forçando shutdown.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[notifications-service] Erro fatal durante inicialização:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

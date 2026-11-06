import { createApp } from './app';
import { env } from './config/env';
import { initDatabase, pool } from './config/database';
import { broker } from './messaging';
import { registerOrderConfirmedConsumer } from './messaging/order.consumer';
import { fleet } from './container';

async function bootstrap() {
  try {
    console.log(`[logistics-service] Inicializando serviço em ambiente: ${env.NODE_ENV}...`);

    await initDatabase();

    // MQTT e RabbitMQ conectam em background e reconectam sozinhos
    fleet.connect();
    void broker
      .connect()
      .then(() => registerOrderConfirmedConsumer())
      .catch((err) =>
        console.error('[logistics-service] Falha ao inicializar mensageria:', err)
      );

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`[logistics-service] Servidor rodando na porta ${env.PORT}`);
      console.log(
        `[logistics-service] CD em (${env.WAREHOUSE_LAT}, ${env.WAREHOUSE_LNG}), broker MQTT ${env.MQTT_URL}`
      );
    });

    const gracefulShutdown = (signal: string) => {
      console.log(`[logistics-service] Sinal ${signal} recebido. Encerrando conexões...`);
      server.close(async () => {
        try {
          await fleet.close();
          await broker.close();
          await pool.end();
          console.log('[logistics-service] Conexões fechadas com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('[logistics-service] Erro ao fechar recursos:', err);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error('[logistics-service] Timeout de encerramento, forçando shutdown.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[logistics-service] Erro fatal durante inicialização:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

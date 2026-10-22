import { createApp } from './app';
import { env } from './config/env';
import { initDatabase, pool } from './config/database';
import { broker } from './messaging';
import { registerOrderConsumer } from './messaging/order.consumer';

async function bootstrap() {
  try {
    console.log(`[payments-service] Inicializando serviço em ambiente: ${env.NODE_ENV}...`);

    await initDatabase();

    // Conecta em background, senao o boot fica preso esperando o broker
    void broker
      .connect()
      .then(() => registerOrderConsumer())
      .catch((err) =>
        console.error('[payments-service] Falha ao inicializar mensageria:', err)
      );

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`[payments-service] Servidor rodando na porta ${env.PORT}`);
      console.log(
        `[payments-service] Simulação do gateway: latência ${env.PAYMENT_LATENCY_MS}ms, ` +
          `taxa de falha transitória ${(env.PAYMENT_FAILURE_RATE * 100).toFixed(0)}%, ` +
          `limite R$ ${env.PAYMENT_MAX_AMOUNT.toFixed(2)}`
      );
    });

    const gracefulShutdown = (signal: string) => {
      console.log(`[payments-service] Sinal ${signal} recebido. Encerrando conexões...`);
      server.close(async () => {
        try {
          await broker.close();
          await pool.end();
          console.log('[payments-service] Conexões fechadas com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('[payments-service] Erro ao fechar recursos:', err);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error('[payments-service] Timeout de encerramento, forçando shutdown.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[payments-service] Erro fatal durante inicialização:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

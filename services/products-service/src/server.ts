import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';

async function bootstrap() {
  try {
    console.log(`[products-service] Inicializando serviço em ambiente: ${env.NODE_ENV}...`);

    // Conecta ao MongoDB
    await connectDatabase();
    const { seedProductsIfEmpty } = await import('./config/seed');
    await seedProductsIfEmpty();

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`[products-service] Servidor rodando com sucesso na porta ${env.PORT}`);
      console.log(`[products-service] Health check disponível em: http://localhost:${env.PORT}/health`);
    });

    // Tratamento de Graceful Shutdown (Padrão de Sistemas Distribuídos e Kubernetes)
    const gracefulShutdown = (signal: string) => {
      console.log(`[products-service] Sinal ${signal} recebido. Encerrando conexões de forma ordenada...`);
      server.close(async () => {
        console.log('[products-service] Servidor HTTP fechado.');
        try {
          await disconnectDatabase();
          console.log('[products-service] Conexão com MongoDB encerrada com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('[products-service] Erro ao desconectar do MongoDB:', err);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error('[products-service] Não foi possível encerrar a tempo, finalizando forçadamente.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[products-service] Erro fatal durante a inicialização:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('[products-service] Conectado ao MongoDB com sucesso.');
  } catch (error) {
    console.error('[products-service] Erro ao conectar ao MongoDB:', error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log('[products-service] Desconectado do MongoDB.');
  } catch (error) {
    console.error('[products-service] Erro ao desconectar do MongoDB:', error);
  }
}

export function checkDatabaseHealth(): boolean {
  // 1 = connected, 2 = connecting
  return mongoose.connection.readyState === 1;
}

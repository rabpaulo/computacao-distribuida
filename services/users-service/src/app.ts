import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middlewares/error.middleware';

export function createApp(): Application {
  const app = express();

  // Middlewares essenciais de segurança e parsing
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  // Rotas de monitoramento / Probes K8s
  app.use('/', healthRoutes);

  // Rotas da API v1
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);

  // Rota 404 para endpoints não encontrados
  app.use('*', (_req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Recurso não encontrado no users-service',
    });
  });

  // Handler de erros centralizado
  app.use(errorHandler);

  return app;
}

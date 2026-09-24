import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import productRoutes from './routes/product.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middlewares/error.middleware';

export function createApp(): Application {
  const app = express();

  // Middlewares de segurança e parse de JSON
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  // Rotas de observabilidade / Probes
  app.use('/', healthRoutes);

  // Rotas da API de produtos
  app.use('/api/v1/products', productRoutes);

  // Rota 404
  app.use('*', (_req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Recurso não encontrado no products-service',
    });
  });

  // Handler de erros centralizado
  app.use(errorHandler);

  return app;
}

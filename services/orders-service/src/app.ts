import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import orderRoutes from './routes/order.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middlewares/error.middleware';

export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  app.use('/', healthRoutes);
  app.use('/api/v1/orders', orderRoutes);

  app.use('*', (_req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Recurso não encontrado no orders-service',
    });
  });

  app.use(errorHandler);

  return app;
}

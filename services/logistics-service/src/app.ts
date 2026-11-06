import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import shipmentRoutes from './routes/shipment.routes';
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
  app.use('/api/v1/shipments', shipmentRoutes);

  app.use('*', (_req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Recurso não encontrado no logistics-service',
    });
  });

  app.use(errorHandler);

  return app;
}

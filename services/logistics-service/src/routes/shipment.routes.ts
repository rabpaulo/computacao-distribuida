import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { AppError } from '../middlewares/error.middleware';
import { fleet, shipmentService } from '../container';

const router = Router();

router.use(authenticateToken);

const byOrderSchema = z.object({
  params: z.object({ orderId: z.string().uuid('ID de pedido inválido') }),
});

router.get('/my-shipments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new AppError(401, 'Usuário não autenticado');
    const shipments = await shipmentService.listByUser(req.user.userId);
    res.json({ status: 'success', data: { shipments } });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/order/:orderId',
  validateRequest(byOrderSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AppError(401, 'Usuário não autenticado');
      const shipment = await shipmentService.getByOrderId(
        req.params.orderId,
        req.user.userId,
        req.user.role
      );
      res.json({ status: 'success', data: { shipment } });
    } catch (err) {
      next(err);
    }
  }
);

// Visao da frota em tempo real (estado vindo do MQTT)
router.get('/fleet', (_req: Request, res: Response) => {
  res.json({ status: 'success', data: { trucks: fleet.listTrucks() } });
});

export default router;

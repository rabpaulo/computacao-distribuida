import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service';
import { AppError } from '../middlewares/error.middleware';

export const getPaymentByOrderSchema = z.object({
  params: z.object({
    orderId: z.string().uuid('ID de pedido inválido'),
  }),
});

export class PaymentController {
  // Pagamento de um pedido especifico
  async getByOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const payment = await paymentService.getByOrderId(
        req.params.orderId,
        req.user.userId,
        req.user.role
      );

      res.status(200).json({
        status: 'success',
        data: { payment },
      });
    } catch (error) {
      next(error);
    }
  }

  // Historico do usuario logado
  async listMine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const payments = await paymentService.listByUser(req.user.userId);

      res.status(200).json({
        status: 'success',
        data: { payments },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const paymentController = new PaymentController();

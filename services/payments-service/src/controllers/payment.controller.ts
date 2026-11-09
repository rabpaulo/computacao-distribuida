import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service';
import { AppError } from '../middlewares/error.middleware';

export const getPaymentByOrderSchema = z.object({
  params: z.object({
    orderId: z.string().uuid('ID de pedido inválido'),
  }),
});

export const approvePayPalSchema = z.object({
  params: z.object({
    orderId: z.string().uuid('ID de pedido inválido'),
  }),
  body: z
    .object({
      // DECLINE simula o PayPal recusando o meio de pagamento na captura
      decision: z.enum(['APPROVE', 'DECLINE']).default('APPROVE'),
      // Metodo escolhido na tela. Dados de cartao NUNCA chegam aqui.
      method: z.enum(['PAYPAL', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'BOLETO']).default('PAYPAL'),
    })
    .default({}),
});

export class PaymentController {
  // Comprador aprovou na tela (simulada) do PayPal: captura o pagamento
  async approvePayPal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const payment = await paymentService.approve(
        req.params.orderId,
        req.user.userId,
        req.user.role,
        req.body?.decision === 'DECLINE' ? 'DECLINE' : 'APPROVE',
        req.body?.method ?? 'PAYPAL'
      );

      res.status(200).json({ status: 'success', data: { payment } });
    } catch (error) {
      next(error);
    }
  }

  // Comprador fechou/cancelou a tela do PayPal
  async cancelPayPal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const payment = await paymentService.cancel(
        req.params.orderId,
        req.user.userId,
        req.user.role
      );

      res.status(200).json({ status: 'success', data: { payment } });
    } catch (error) {
      next(error);
    }
  }

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

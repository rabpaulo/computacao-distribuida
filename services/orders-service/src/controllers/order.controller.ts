import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { orderService } from '../services/order.service';
import { AppError } from '../middlewares/error.middleware';

export const createOrderSchema = z.object({
  body: z.object({
    items: z.array(
      z.object({
        productId: z.string().min(1, 'ID do produto é obrigatório'),
        productName: z.string().min(1, 'Nome do produto é obrigatório'),
        price: z.number().positive('Preço deve ser positivo'),
        quantity: z.number().int().positive('Quantidade deve ser positiva'),
      })
    ).min(1, 'O pedido deve conter ao menos um item'),
  }),
});

export const getOrderByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID de pedido inválido'),
  }),
});

export class OrderController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

      const order = await orderService.create(
        {
          userId: req.user.userId,
          items: req.body.items,
        },
        token
      );

      res.status(201).json({
        status: 'success',
        message: 'Pedido registrado. Pagamento em processamento assíncrono.',
        data: { order },
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const orders = await orderService.getMyOrders(req.user.userId);
      res.status(200).json({
        status: 'success',
        data: { orders },
      });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Usuário não autenticado');
      }

      const order = await orderService.getById(req.params.id, req.user.userId, req.user.role);
      res.status(200).json({
        status: 'success',
        data: { order },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const orderController = new OrderController();

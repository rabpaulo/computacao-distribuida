import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.service';
import { AppError } from '../middlewares/error.middleware';

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres').max(150),
  }),
});

export const getUserByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID de usuário inválido (deve ser UUID)'),
  }),
});

export class UserController {
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Não autenticado');
      }

      const user = await userService.getById(req.user.userId);
      res.status(200).json({
        status: 'success',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Não autenticado');
      }

      const updated = await userService.updateProfile(req.user.userId, req.body);
      res.status(200).json({
        status: 'success',
        message: 'Perfil atualizado com sucesso',
        data: { user: updated },
      });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // Usuário comum só pode consultar seu próprio ID a menos que seja ADMIN
      if (req.user?.role !== 'ROLE_ADMIN' && req.user?.userId !== id) {
        throw new AppError(403, 'Acesso não autorizado aos dados deste usuário');
      }

      const user = await userService.getById(id);
      res.status(200).json({
        status: 'success',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
      const page = Math.max(parseInt((req.query.page as string) || '1', 10), 1);
      const offset = (page - 1) * limit;

      const result = await userService.listAll(limit, offset);
      res.status(200).json({
        status: 'success',
        data: {
          users: result.users,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();

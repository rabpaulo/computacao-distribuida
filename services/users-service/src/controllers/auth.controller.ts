import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres').max(150),
    email: z.string().email('E-mail em formato inválido'),
    password: z.string().min(6, 'A senha deve conter pelo menos 6 caracteres'),
    role: z.enum(['ROLE_CUSTOMER', 'ROLE_ADMIN']).optional().default('ROLE_CUSTOMER'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('E-mail em formato inválido'),
    password: z.string().min(1, 'A senha é obrigatória'),
  }),
});

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({
        status: 'success',
        message: 'Usuário cadastrado com sucesso',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.login(req.body);
      res.status(200).json({
        status: 'success',
        message: 'Autenticação realizada com sucesso',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();

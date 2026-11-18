import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { privacyService } from '../services/privacy.service';
import { AppError } from '../middlewares/error.middleware';

export const deleteAccountSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Informe sua senha para confirmar a exclusão'),
  }),
});

export class PrivacyController {
  // Direito de acesso e portabilidade (LGPD, art. 18, II e V)
  async exportMyData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Não autenticado');

      const data = await privacyService.exportData(req.user.userId);
      res.setHeader('Content-Disposition', 'attachment; filename="meus-dados-districommerce.json"');
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  }

  // Direito de eliminação (LGPD, art. 18, VI)
  async deleteMyAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Não autenticado');

      await privacyService.deleteAccount(req.user.userId, req.body.password);
      res.status(200).json({
        status: 'success',
        message: 'Sua conta foi removida e seus dados pessoais foram apagados.',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const privacyController = new PrivacyController();

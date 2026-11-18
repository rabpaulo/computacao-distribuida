import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { hub, notificationService } from '../container';
import { AppError } from '../middlewares/error.middleware';

export const listNotificationsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    unread: z.enum(['true', 'false']).optional(),
  }),
});

export const notificationIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID de notificação inválido'),
  }),
});

// setTimeout não aceita atraso maior que 2^31-1 ms
const MAX_TIMER_MS = 2 ** 31 - 1;

export class NotificationController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Usuário não autenticado');

      const { limit, unread } = req.query as unknown as { limit: number; unread?: 'true' | 'false' };
      const data = await notificationService.list(req.user.userId, {
        limit,
        unreadOnly: unread === 'true',
      });
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  }

  async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Usuário não autenticado');

      const updated = await notificationService.markRead(req.user.userId, req.params.id);
      if (!updated) throw new AppError(404, 'Notificação não encontrada');

      res.status(200).json({ status: 'success', message: 'Notificação marcada como lida' });
    } catch (error) {
      next(error);
    }
  }

  async markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Usuário não autenticado');

      const updated = await notificationService.markAllRead(req.user.userId);
      res.status(200).json({ status: 'success', data: { updated } });
    } catch (error) {
      next(error);
    }
  }

  // Server-Sent Events: a conexão fica aberta e o servidor escreve quando há novidade.
  // O que o navegador perdeu enquanto estava desconectado ele recupera listando de novo
  // (o cliente faz isso ao receber o evento "ready").
  stream(req: Request, res: Response): void {
    if (!req.user) {
      res.status(401).json({ status: 'error', message: 'Usuário não autenticado' });
      return;
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx: não guardar a resposta em buffer, senão o evento só chega quando o buffer enche
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // retry: quanto o navegador espera antes de reconectar sozinho
    res.write('retry: 5000\n\n');

    const remove = hub.add(req.user.userId, res);
    res.write('event: ready\ndata: {}\n\n');

    // Passou da validade do token, a conexão fecha. O cliente reconecta e, se o
    // token expirou de fato, é barrado em authenticateToken.
    let expiry: NodeJS.Timeout | undefined;
    if (req.user.exp) {
      const msLeft = req.user.exp * 1000 - Date.now();
      expiry = setTimeout(() => res.end(), Math.min(Math.max(msLeft, 0), MAX_TIMER_MS));
      expiry.unref();
    }

    req.on('close', () => {
      if (expiry) clearTimeout(expiry);
      remove();
    });
  }
}

export const notificationController = new NotificationController();

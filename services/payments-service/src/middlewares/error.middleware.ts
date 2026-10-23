import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly details?: unknown
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  console.error('[payments-service] Erro não tratado:', err);

  res.status(500).json({
    status: 'error',
    message: 'Erro interno do servidor',
    ...(env.NODE_ENV === 'development' ? { stack: err.stack, details: err.message } : {}),
  });
}

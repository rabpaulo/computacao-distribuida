import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'ROLE_CUSTOMER' | 'ROLE_ADMIN';
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    res.status(401).json({
      status: 'error',
      message: 'Token de autenticação não fornecido',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({
      status: 'error',
      message: 'Token de autenticação inválido ou expirado',
    });
    return;
  }
}

export function requireRole(allowedRoles: Array<'ROLE_CUSTOMER' | 'ROLE_ADMIN'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        status: 'error',
        message: 'Usuário não autenticado',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        status: 'error',
        message: 'Acesso restrito: permissão insuficiente para gerenciar catálogo de produtos',
      });
      return;
    }

    next();
  };
}

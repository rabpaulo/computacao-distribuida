import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  // Instante de expiração do token (segundos desde 1970), preenchido pelo jsonwebtoken
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

// O token vai no header Authorization e nunca na URL (a URL aparece em log de proxy).
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
    req.user = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    next();
  } catch {
    res.status(403).json({
      status: 'error',
      message: 'Token inválido ou expirado',
    });
  }
}

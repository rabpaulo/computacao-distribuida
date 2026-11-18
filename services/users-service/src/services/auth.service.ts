import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { env } from '../config/env';
import { SafeUser, toSafeUser, USER_COLUMNS, User, UserRole } from '../models/user';
import { AppError } from '../middlewares/error.middleware';

export interface RegisterDTO {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  // LGPD: o titular precisa aceitar a Política de Privacidade para criar a conta
  acceptTerms: boolean;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthResult {
  user: SafeUser;
  token: string;
}

export class AuthService {
  async register(data: RegisterDTO): Promise<AuthResult> {
    // O controller já valida; aqui é a garantia de que nenhum outro caminho
    // cria conta sem consentimento registrado
    if (data.acceptTerms !== true) {
      throw new AppError(400, 'É necessário aceitar a Política de Privacidade para se cadastrar');
    }

    const normalizedEmail = data.email.toLowerCase().trim();

    // Verifica se e-mail já existe
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      throw new AppError(409, 'E-mail já cadastrado na plataforma');
    }

    // Hash seguro da senha
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(data.password, saltRounds);

    const userId = uuidv4();
    const role: UserRole = data.role === 'ROLE_ADMIN' ? 'ROLE_ADMIN' : 'ROLE_CUSTOMER';

    // consent_at/consent_version: prova de quando e qual versão da política o titular aceitou
    const insertQuery = `
      INSERT INTO users (id, name, email, password_hash, role, consent_at, consent_version)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)
      RETURNING ${USER_COLUMNS}
    `;

    const result = await pool.query<User>(insertQuery, [
      userId,
      data.name.trim(),
      normalizedEmail,
      passwordHash,
      role,
      env.PRIVACY_POLICY_VERSION,
    ]);

    const createdUser = result.rows[0];
    const safeUser = toSafeUser(createdUser);
    const token = this.generateToken(safeUser);

    return { user: safeUser, token };
  }

  async login(data: LoginDTO): Promise<AuthResult> {
    const normalizedEmail = data.email.toLowerCase().trim();

    const query = `
      SELECT ${USER_COLUMNS}
      FROM users
      WHERE email = $1
    `;
    const result = await pool.query<User>(query, [normalizedEmail]);

    if (result.rows.length === 0) {
      throw new AppError(401, 'Credenciais inválidas');
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(data.password, user.password_hash);

    if (!isPasswordValid) {
      throw new AppError(401, 'Credenciais inválidas');
    }

    const safeUser = toSafeUser(user);
    const token = this.generateToken(safeUser);

    return { user: safeUser, token };
  }

  private generateToken(user: SafeUser): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    );
  }
}

export const authService = new AuthService();

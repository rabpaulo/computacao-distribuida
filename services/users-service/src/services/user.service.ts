import { pool } from '../config/database';
import { SafeUser, toSafeUser, User } from '../models/user';
import { AppError } from '../middlewares/error.middleware';

export interface UpdateProfileDTO {
  name?: string;
}

export class UserService {
  async getById(id: string): Promise<SafeUser> {
    const query = `
      SELECT id, name, email, password_hash, role, created_at, updated_at
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query<User>(query, [id]);

    if (result.rows.length === 0) {
      throw new AppError(404, 'Usuário não encontrado');
    }

    return toSafeUser(result.rows[0]);
  }

  async updateProfile(id: string, data: UpdateProfileDTO): Promise<SafeUser> {
    if (!data.name || data.name.trim().length === 0) {
      throw new AppError(400, 'Nenhum dado válido fornecido para atualização');
    }

    const query = `
      UPDATE users
      SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, name, email, password_hash, role, created_at, updated_at
    `;

    const result = await pool.query<User>(query, [data.name.trim(), id]);

    if (result.rows.length === 0) {
      throw new AppError(404, 'Usuário não encontrado para atualização');
    }

    return toSafeUser(result.rows[0]);
  }

  async listAll(limit = 50, offset = 0): Promise<{ users: SafeUser[]; total: number }> {
    const countResult = await pool.query('SELECT COUNT(*) as total FROM users');
    const total = parseInt(countResult.rows[0].total, 10);

    const query = `
      SELECT id, name, email, password_hash, role, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query<User>(query, [limit, offset]);

    return {
      users: result.rows.map(toSafeUser),
      total,
    };
  }
}

export const userService = new UserService();

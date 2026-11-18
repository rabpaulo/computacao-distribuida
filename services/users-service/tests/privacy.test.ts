import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { pool } from '../src/config/database';
import { env } from '../src/config/env';
import { publisher } from '../src/messaging/publisher';

vi.mock('../src/config/database', () => ({
  pool: { query: vi.fn(), end: vi.fn() },
  initDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/messaging/publisher', () => ({
  publisher: {
    publish: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    close: vi.fn(),
    isHealthy: vi.fn().mockReturnValue(true),
  },
  ROUTING_KEYS: { USER_DELETED: 'user.deleted' },
  EVENTS_EXCHANGE: 'districommerce.events',
}));

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const PASSWORD = 'senhaCorreta123';

const query = vi.mocked(pool.query);
const publish = vi.mocked(publisher.publish);

function token(role = 'ROLE_CUSTOMER'): string {
  return jwt.sign({ userId: USER_ID, email: 'carlos@example.com', role }, env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

async function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    name: 'Carlos Oliveira',
    email: 'carlos@example.com',
    password_hash: await bcrypt.hash(PASSWORD, 10),
    role: 'ROLE_CUSTOMER',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
    consent_at: new Date('2026-01-01T00:00:00Z'),
    consent_version: '1.0',
    anonymized_at: null,
    ...overrides,
  };
}

describe('Users Service - LGPD (direitos do titular)', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    publish.mockResolvedValue(undefined);
  });

  describe('GET /api/v1/users/me/export (acesso e portabilidade)', () => {
    it('exige autenticação', async () => {
      const response = await request(app).get('/api/v1/users/me/export');
      expect(response.status).toBe(401);
    });

    it('devolve os dados do titular, sem o hash da senha, como download', async () => {
      query.mockResolvedValueOnce({ rows: [await userRow()] } as never);

      const response = await request(app)
        .get('/api/v1/users/me/export')
        .set('Authorization', `Bearer ${token()}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('meus-dados-districommerce.json');
      expect(response.body.data.user).toMatchObject({
        id: USER_ID,
        email: 'carlos@example.com',
        consent_version: '1.0',
      });
      expect(response.body.data.policyVersion).toBe(env.PRIVACY_POLICY_VERSION);
      expect(response.body.data.exportedAt).toEqual(expect.any(String));
      expect(JSON.stringify(response.body)).not.toContain('password_hash');
    });

    it('conta já removida responde 410', async () => {
      query.mockResolvedValueOnce({ rows: [await userRow({ anonymized_at: new Date() })] } as never);

      const response = await request(app)
        .get('/api/v1/users/me/export')
        .set('Authorization', `Bearer ${token()}`);

      expect(response.status).toBe(410);
    });
  });

  describe('DELETE /api/v1/users/me (eliminação)', () => {
    it('exige autenticação', async () => {
      const response = await request(app).delete('/api/v1/users/me').send({ password: PASSWORD });
      expect(response.status).toBe(401);
    });

    it('exige a senha no corpo da requisição', async () => {
      const response = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token()}`)
        .send({});

      expect(response.status).toBe(400);
      expect(publish).not.toHaveBeenCalled();
    });

    it('recusa senha incorreta e não apaga nada', async () => {
      query.mockResolvedValueOnce({ rows: [await userRow()] } as never);

      const response = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token()}`)
        .send({ password: 'senha-errada' });

      expect(response.status).toBe(401);
      expect(publish).not.toHaveBeenCalled();
      // só a consulta do usuário, nenhum UPDATE
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('avisa os outros serviços (user.deleted) e anonimiza a conta', async () => {
      query
        .mockResolvedValueOnce({ rows: [await userRow()] } as never) // SELECT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // UPDATE

      const response = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token()}`)
        .send({ password: PASSWORD });

      expect(response.status).toBe(200);

      expect(publish).toHaveBeenCalledTimes(1);
      const [routingKey, payload] = publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(routingKey).toBe('user.deleted');
      expect(payload).toMatchObject({ eventType: 'user.deleted', userId: USER_ID });
      expect(payload.eventId).toEqual(expect.any(String));

      const [sql, params] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain("name = 'Usuário removido'");
      expect(sql).toContain('anonymized_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('consent_at = NULL');
      expect(params[0]).toBe(USER_ID);
      // e-mail original sai do banco; o novo não identifica ninguém
      expect(params[1]).toBe(`removido-${USER_ID}@anonimizado.invalid`);
      // a senha antiga não serve mais
      expect(await bcrypt.compare(PASSWORD, params[2] as string)).toBe(false);
    });

    it('com o broker fora do ar devolve 503 e NÃO anonimiza (nada de exclusão pela metade)', async () => {
      query.mockResolvedValueOnce({ rows: [await userRow()] } as never);
      publish.mockRejectedValueOnce(new Error('Canal AMQP indisponível: broker desconectado'));

      const response = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token()}`)
        .send({ password: PASSWORD });

      expect(response.status).toBe(503);
      expect(response.body.message).toContain('Tente novamente');
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('conta já removida responde 410', async () => {
      query.mockResolvedValueOnce({ rows: [await userRow({ anonymized_at: new Date() })] } as never);

      const response = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token()}`)
        .send({ password: PASSWORD });

      expect(response.status).toBe(410);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('Conta removida no restante da API', () => {
    it('o token antigo não lê mais o perfil (410)', async () => {
      query.mockResolvedValueOnce({ rows: [await userRow({ anonymized_at: new Date() })] } as never);

      const response = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token()}`);

      expect(response.status).toBe(410);
    });

    it('a listagem de admin ignora contas anonimizadas', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] } as never)
        .mockResolvedValueOnce({ rows: [await userRow()] } as never);

      const response = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${token('ROLE_ADMIN')}`);

      expect(response.status).toBe(200);
      expect(String(query.mock.calls[0][0])).toContain('anonymized_at IS NULL');
      expect(String(query.mock.calls[1][0])).toContain('anonymized_at IS NULL');
    });
  });
});

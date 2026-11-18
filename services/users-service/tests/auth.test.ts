import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { pool } from '../src/config/database';
import { env } from '../src/config/env';

// Mock do pool do PostgreSQL para testes unitários/integrados isolados
vi.mock('../src/config/database', () => {
  return {
    pool: {
      query: vi.fn(),
      end: vi.fn(),
    },
    initDatabase: vi.fn().mockResolvedValue(undefined),
    checkDatabaseHealth: vi.fn().mockResolvedValue(true),
  };
});

describe('Users Service - Testes Unitários e de Integração', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Endpoints de Saúde (/health e /ready)', () => {
    it('deve retornar status UP na rota /health', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('UP');
      expect(response.body.service).toBe('users-service');
    });

    it('deve retornar status READY na rota /ready quando o banco estiver acessível', async () => {
      const response = await request(app).get('/ready');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('READY');
      expect(response.body.database).toBe('CONNECTED');
    });
  });

  describe('Autenticação (/api/v1/auth)', () => {
    it('deve rejeitar cadastro com e-mail inválido', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'João Silva',
          email: 'email-invalido',
          password: '123456SenhaValida',
          acceptTerms: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('validação');
    });

    it('deve rejeitar cadastro com senha menor que 6 caracteres', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'João Silva',
          email: 'joao@example.com',
          password: '123',
          acceptTerms: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
    });

    it('deve cadastrar usuário com sucesso quando os dados forem válidos', async () => {
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Carlos Oliveira',
        email: 'carlos@example.com',
        password_hash: 'hashedpassword',
        role: 'ROLE_CUSTOMER',
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Mock pool: primeira query (SELECT id FROM users) retorna vazio; segunda query (INSERT) retorna mockUser
      (pool.query as any)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [mockUser] });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Carlos Oliveira',
          email: 'carlos@example.com',
          password: 'senhaSegura123',
          acceptTerms: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.data.user.email).toBe('carlos@example.com');
      expect(response.body.data.user).not.toHaveProperty('password_hash');
      expect(response.body.data.token).toBeDefined();

      // LGPD: o consentimento fica gravado (quando e qual versão da política)
      const insert = (pool.query as any).mock.calls[1];
      expect(insert[0]).toContain('consent_at');
      expect(insert[0]).toContain('consent_version');
      expect(insert[1]).toContain(env.PRIVACY_POLICY_VERSION);
    });

    it.each([
      ['sem o campo acceptTerms', {}],
      ['com acceptTerms false', { acceptTerms: false }],
      ['com acceptTerms como texto "true"', { acceptTerms: 'true' }],
    ])('deve rejeitar cadastro %s (LGPD: consentimento explícito)', async (_nome, extra) => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Carlos Oliveira',
          email: 'carlos@example.com',
          password: 'senhaSegura123',
          ...extra,
        });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.errors)).toContain('Política de Privacidade');
      // nem chegou a consultar o banco
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('deve autenticar usuário válido no login', async () => {
      const rawPassword = 'minhaSenhaForte';
      const hash = await bcrypt.hash(rawPassword, 10);
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Carlos Oliveira',
        email: 'carlos@example.com',
        password_hash: hash,
        role: 'ROLE_CUSTOMER',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as any).mockResolvedValueOnce({ rows: [mockUser] });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'carlos@example.com',
          password: rawPassword,
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.data.token).toBeDefined();

      // Validação do token retornado
      const decoded = jwt.verify(response.body.data.token, env.JWT_SECRET) as any;
      expect(decoded.email).toBe('carlos@example.com');
      expect(decoded.userId).toBe(mockUser.id);
    });

    it('deve rejeitar login com senha incorreta', async () => {
      const hash = await bcrypt.hash('senhaCorreta', 10);
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Carlos Oliveira',
        email: 'carlos@example.com',
        password_hash: hash,
        role: 'ROLE_CUSTOMER',
      };

      (pool.query as any).mockResolvedValueOnce({ rows: [mockUser] });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'carlos@example.com',
          password: 'senhaErrada',
        });

      expect(response.status).toBe(401);
      expect(response.body.status).toBe('error');
    });
  });

  describe('Rotas Protegidas de Usuários (/api/v1/users)', () => {
    it('deve recusar acesso a rota protegida sem token', async () => {
      const response = await request(app).get('/api/v1/users/profile');
      expect(response.status).toBe(401);
      expect(response.body.message).toContain('não fornecido');
    });

    it('deve permitir acesso ao perfil com token válido', async () => {
      const token = jwt.sign(
        { userId: '123e4567-e89b-12d3-a456-426614174000', email: 'carlos@example.com', role: 'ROLE_CUSTOMER' },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Carlos Oliveira',
        email: 'carlos@example.com',
        password_hash: 'hash',
        role: 'ROLE_CUSTOMER',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as any).mockResolvedValueOnce({ rows: [mockUser] });

      const response = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.user.name).toBe('Carlos Oliveira');
    });
  });
});

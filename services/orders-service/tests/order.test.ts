import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { pool } from '../src/config/database';
import { env } from '../src/config/env';

vi.mock('../src/config/database', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'order-1', user_id: 'user-123', total_amount: '150.00', status: 'CONFIRMED' }] }),
      release: vi.fn(),
    }),
    end: vi.fn(),
  },
  initDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
}));

describe('Orders Service - Testes Unitários e de Integração', () => {
  const app = createApp();

  const userToken = jwt.sign(
    { userId: 'user-123', email: 'user@districommerce.com', role: 'ROLE_CUSTOMER' },
    env.JWT_SECRET
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Probes (/health e /ready)', () => {
    it('deve responder status UP em /health', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.service).toBe('orders-service');
    });

    it('deve responder status READY em /ready quando conectado', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');
      expect(res.body.database).toBe('CONNECTED');
    });
  });

  describe('Criação de Pedidos (/api/v1/orders)', () => {
    it('deve rejeitar criação de pedido sem autenticação', async () => {
      const res = await request(app).post('/api/v1/orders').send({
        items: [
          { productId: 'prod-1', productName: 'Mouse', price: 100, quantity: 1 }
        ]
      });

      expect(res.status).toBe(401);
    });

    it('deve rejeitar pedido com lista de itens vazia', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ items: [] });

      expect(res.status).toBe(400);
    });

    it('deve criar pedido com sucesso quando autenticado e com itens válidos', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          items: [
            { productId: 'prod-1', productName: 'Mouse', price: 100, quantity: 1 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.order).toBeDefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { broker } from '../src/messaging';
import { pool } from '../src/config/database';
import { orderService } from '../src/services/order.service';
import { ROUTING_KEYS } from '../src/messaging/config';

vi.mock('../src/config/database', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '6f1b2f3e-9c4a-4f8d-9b7e-1a2b3c4d5e6f',
            user_id: 'user-123',
            total_amount: '150.00',
            status: 'PENDING',
          },
        ],
      }),
      release: vi.fn(),
    }),
    end: vi.fn(),
  },
  initDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
}));

// Dublê do broker: os testes não sobem RabbitMQ, mas conferem que o
// evento sai no checkout.
vi.mock('../src/messaging', () => ({
  broker: {
    isHealthy: vi.fn().mockReturnValue(true),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));

const ORDER_ID = '6f1b2f3e-9c4a-4f8d-9b7e-1a2b3c4d5e6f';

describe('Orders Service - Testes Unitários e de Integração', () => {
  const app = createApp();

  const userToken = jwt.sign(
    { userId: 'user-123', email: 'user@districommerce.com', role: 'ROLE_CUSTOMER' },
    env.JWT_SECRET
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(broker.isHealthy).mockReturnValue(true);
    vi.mocked(broker.publish).mockResolvedValue(undefined);
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
      expect(res.body.messaging).toBe('CONNECTED');
    });

    it('deve responder DEGRADED em /ready quando o broker está fora do ar', async () => {
      vi.mocked(broker.isHealthy).mockReturnValue(false);

      const res = await request(app).get('/ready');

      // 207 porque o serviço ainda responde, só não consegue fechar pedido
      expect(res.status).toBe(207);
      expect(res.body.status).toBe('DEGRADED');
      expect(res.body.database).toBe('CONNECTED');
      expect(res.body.messaging).toBe('DISCONNECTED');
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

    it('deve nascer PENDING e publicar order.created no broker', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          items: [
            { productId: 'prod-1', productName: 'Mouse', price: 100, quantity: 1 }
          ]
        });

      expect(res.status).toBe(201);
      // Checkout não confirma nada, quem confirma é a fila
      expect(res.body.data.order.status).toBe('PENDING');

      expect(broker.publish).toHaveBeenCalledTimes(1);
      const [routingKey, event] = vi.mocked(broker.publish).mock.calls[0];
      expect(routingKey).toBe(ROUTING_KEYS.ORDER_CREATED);
      expect(event).toMatchObject({
        eventType: 'order.created',
        orderId: '6f1b2f3e-9c4a-4f8d-9b7e-1a2b3c4d5e6f',
        userId: 'user-123',
      });
    });

    it('deve concluir o checkout mesmo com o broker indisponível', async () => {
      // Regressão: publish travado ou propagando erro derrubaria o checkout
      vi.mocked(broker.publish).mockRejectedValue(
        new Error('Canal AMQP indisponível: broker desconectado')
      );

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          items: [
            { productId: 'prod-1', productName: 'Mouse', price: 100, quantity: 1 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.data.order.status).toBe('PENDING');
    });
  });

  describe('Resultado do pagamento (vindo da fila)', () => {
    it('deve devolver o estoque quando o pagamento é recusado', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      vi.mocked(pool.query)
        // UPDATE orders -> cancelou
        .mockResolvedValueOnce({ rows: [{ id: ORDER_ID }], rowCount: 1 } as never)
        // SELECT dos itens que precisam voltar pro catálogo
        .mockResolvedValueOnce({
          rows: [{ product_id: 'prod-1', product_name: 'Mouse', quantity: 3 }],
          rowCount: 1,
        } as never);

      const mudou = await orderService.applyPaymentResult(ORDER_ID, 'CANCELLED', 'sem saldo');

      expect(mudou).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/v1/products/prod-1/stock');
      expect(init.method).toBe('PATCH');
      // delta positivo = devolvendo as unidades
      expect(JSON.parse(init.body)).toEqual({ delta: 3 });

      vi.unstubAllGlobals();
    });

    it('não deve mexer no estoque quando o pagamento é aprovado', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: ORDER_ID }],
        rowCount: 1,
      } as never);

      await orderService.applyPaymentResult(ORDER_ID, 'CONFIRMED');

      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('deve ignorar evento repetido sem devolver estoque duas vezes', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      // Pedido já saiu de PENDING, então o UPDATE não pega nada
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const mudou = await orderService.applyPaymentResult(ORDER_ID, 'CANCELLED', 'sem saldo');

      expect(mudou).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});

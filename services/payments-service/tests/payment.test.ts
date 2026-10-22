import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/config/database';
import { env } from '../src/config/env';
import { paymentService, TransientPaymentError } from '../src/services/payment.service';
import { OrderCreatedEvent } from '../src/messaging/events';

vi.mock('../src/config/database', () => ({
  pool: {
    query: vi.fn(),
    end: vi.fn(),
  },
  initDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
}));

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

function buildEvent(totalAmount: number): OrderCreatedEvent {
  return {
    eventId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    eventType: 'order.created',
    occurredAt: new Date().toISOString(),
    orderId: ORDER_ID,
    userId: 'user-123',
    totalAmount,
    items: [{ productId: 'prod-1', productName: 'Mouse', price: totalAmount, quantity: 1 }],
  };
}

// Linha como o Postgres devolve
function buildRow(status: string, amount: number, reason: string | null = null) {
  return {
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    order_id: ORDER_ID,
    user_id: 'user-123',
    amount: amount.toFixed(2),
    status,
    reason,
    attempts: 1,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('Payments Service - Pagamento Assíncrono', () => {
  const app = createApp();
  const query = vi.mocked(pool.query);

  beforeEach(() => {
    vi.clearAllMocks();
    // Sem latência e sem falha aleatória, senão o teste fica instável
    env.PAYMENT_LATENCY_MS = 0;
    env.PAYMENT_FAILURE_RATE = 0;
    env.PAYMENT_MAX_AMOUNT = 50000;
  });

  describe('Health Probes', () => {
    it('deve responder status UP em /health', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('payments-service');
    });

    it('deve responder READY em /ready com banco e broker conectados', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');
      expect(res.body.messaging).toBe('CONNECTED');
    });
  });

  describe('Autorização', () => {
    it('deve exigir autenticação para consultar pagamentos', async () => {
      const res = await request(app).get('/api/v1/payments/my-payments');
      expect(res.status).toBe(401);
    });
  });

  describe('Processamento do evento order.created', () => {
    it('deve aprovar pagamento dentro do limite autorizado', async () => {
      // 1a query procura pagamento existente, 2a insere
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [buildRow('APPROVED', 150)], rowCount: 1 } as never);

      const result = await paymentService.process(buildEvent(150), 1);

      expect(result.created).toBe(true);
      expect(result.payment.status).toBe('APPROVED');
      expect(result.payment.reason).toBeNull();
    });

    it('deve recusar pagamento acima do limite, sem retentativa', async () => {
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({
          rows: [buildRow('REJECTED', 99999, 'valor acima do limite autorizado de R$ 50000.00')],
          rowCount: 1,
        } as never);

      const result = await paymentService.process(buildEvent(99999), 1);

      expect(result.created).toBe(true);
      expect(result.payment.status).toBe('REJECTED');
      expect(result.payment.reason).toContain('limite autorizado');
    });

    it('deve lançar TransientPaymentError quando o gateway falha', async () => {
      // Falha garantida pra cair no caminho do retry
      env.PAYMENT_FAILURE_RATE = 1;
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await expect(paymentService.process(buildEvent(150), 1)).rejects.toThrow(
        TransientPaymentError
      );

      // Nada gravado, só rodou o SELECT
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('deve ser idempotente em reentrega do broker (não cobra duas vezes)', async () => {
      // Esse pedido já tem pagamento
      query.mockResolvedValueOnce({
        rows: [buildRow('APPROVED', 150)],
        rowCount: 1,
      } as never);

      const result = await paymentService.process(buildEvent(150), 2);

      expect(result.created).toBe(false);
      expect(result.payment.status).toBe('APPROVED');
      // Não tentou inserir de novo
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('deve resolver corrida entre consumidores concorrentes', async () => {
      // SELECT vazio, INSERT perde a corrida, SELECT final pega o vencedor
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [buildRow('APPROVED', 150)], rowCount: 1 } as never);

      const result = await paymentService.process(buildEvent(150), 1);

      expect(result.payment.status).toBe('APPROVED');
      expect(query).toHaveBeenCalledTimes(3);
    });
  });
});

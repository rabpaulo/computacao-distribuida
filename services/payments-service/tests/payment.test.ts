import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { checkDatabaseHealth, pool } from '../src/config/database';
import { env } from '../src/config/env';
import { broker } from '../src/messaging';
import { paymentService, TransientPaymentError } from '../src/services/payment.service';
import { PayPalApiError, PayPalUnavailableError, paypalBreaker, paypalClient } from '../src/paypal/paypal.client';
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
const PAYPAL_ID = '5O190127TN364715T';

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
    method: 'PAYPAL',
    reason,
    attempts: 1,
    paypal_order_id: status === 'REJECTED' && reason?.includes('limite') ? null : PAYPAL_ID,
    paypal_capture_id: status === 'APPROVED' ? '3C679366HH908993F' : null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const paypalOrder = (status: string) => ({
  id: PAYPAL_ID,
  status,
  purchase_units: [
    {
      reference_id: ORDER_ID,
      amount: { currency_code: 'BRL', value: '150.00' },
      ...(status === 'COMPLETED'
        ? { payments: { captures: [{ id: '3C679366HH908993F', status: 'COMPLETED' }] } }
        : {}),
    },
  ],
});

describe('Payments Service - Pagamento via PayPal (simulado)', () => {
  const app = createApp();
  const query = vi.mocked(pool.query);
  const userToken = jwt.sign(
    { userId: 'user-123', email: 'user@districommerce.com', role: 'ROLE_CUSTOMER' },
    env.JWT_SECRET
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    paypalBreaker.reset();
    // restoreAllMocks limpa as implementações dos vi.fn() dos mocks de módulo
    vi.mocked(broker.publish).mockResolvedValue(undefined);
    vi.mocked(broker.isHealthy).mockReturnValue(true);
    vi.mocked(checkDatabaseHealth).mockResolvedValue(true);
    env.PAYMENT_MAX_AMOUNT = 50000;
  });

  describe('Health Probes', () => {
    it('deve responder status UP em /health com o estado do circuit breaker', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('payments-service');
      expect(res.body.circuitBreakers[0]).toMatchObject({ name: 'paypal-gateway', state: 'CLOSED' });
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

  describe('Evento order.created -> ordem PayPal', () => {
    it('deve criar a ordem no PayPal e aguardar aprovação do comprador', async () => {
      const create = vi.spyOn(paypalClient, 'createOrder').mockResolvedValue(paypalOrder('PAYER_ACTION_REQUIRED') as never);
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never);

      const result = await paymentService.process(buildEvent(150), 1);

      expect(create).toHaveBeenCalledWith(ORDER_ID, 150);
      expect(result.created).toBe(true);
      expect(result.payment.status).toBe('PENDING_APPROVAL');
      expect(result.payment.paypal_order_id).toBe(PAYPAL_ID);
    });

    it('deve recusar pagamento acima do limite sem chamar o PayPal', async () => {
      const create = vi.spyOn(paypalClient, 'createOrder');
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({
          rows: [buildRow('REJECTED', 99999, 'valor acima do limite autorizado de R$ 50000.00')],
          rowCount: 1,
        } as never);

      const result = await paymentService.process(buildEvent(99999), 1);

      expect(create).not.toHaveBeenCalled();
      expect(result.payment.status).toBe('REJECTED');
      expect(result.payment.reason).toContain('limite autorizado');
    });

    it('deve lançar TransientPaymentError quando o PayPal está fora (vai pro retry)', async () => {
      vi.spyOn(paypalClient, 'createOrder').mockRejectedValue(new PayPalUnavailableError('HTTP 503'));
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await expect(paymentService.process(buildEvent(150), 1)).rejects.toThrow(TransientPaymentError);
      // Nada gravado, só rodou o SELECT
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('deve ser idempotente em reentrega do broker (não cria outra ordem)', async () => {
      const create = vi.spyOn(paypalClient, 'createOrder');
      query.mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never);

      const result = await paymentService.process(buildEvent(150), 2);

      expect(result.created).toBe(false);
      expect(create).not.toHaveBeenCalled();
    });

    it('deve resolver corrida entre consumidores concorrentes', async () => {
      vi.spyOn(paypalClient, 'createOrder').mockResolvedValue(paypalOrder('PAYER_ACTION_REQUIRED') as never);
      // SELECT vazio, INSERT perde a corrida, SELECT final pega o vencedor
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never);

      const result = await paymentService.process(buildEvent(150), 1);

      expect(result.payment.status).toBe('PENDING_APPROVAL');
      expect(query).toHaveBeenCalledTimes(3);
    });
  });

  describe('Aprovação do comprador (POST /paypal/approve)', () => {
    it('deve capturar e publicar payment.approved', async () => {
      vi.spyOn(paypalClient, 'simulatePayerApproval').mockResolvedValue(paypalOrder('APPROVED') as never);
      vi.spyOn(paypalClient, 'captureOrder').mockResolvedValue(paypalOrder('COMPLETED') as never);
      query
        .mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never)
        .mockResolvedValueOnce({ rows: [buildRow('APPROVED', 150)], rowCount: 1 } as never);

      const res = await request(app)
        .post(`/api/v1/payments/order/${ORDER_ID}/paypal/approve`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ decision: 'APPROVE' });

      expect(res.status).toBe(200);
      expect(res.body.data.payment.status).toBe('APPROVED');
      expect(broker.publish).toHaveBeenCalledWith('payment.approved', expect.objectContaining({ orderId: ORDER_ID }));
    });

    it('deve gravar REJECTED quando o PayPal recusa o meio de pagamento', async () => {
      vi.spyOn(paypalClient, 'simulatePayerApproval').mockResolvedValue(paypalOrder('APPROVED') as never);
      vi.spyOn(paypalClient, 'captureOrder').mockRejectedValue(
        new PayPalApiError(422, 'UNPROCESSABLE_ENTITY', 'INSTRUMENT_DECLINED', 'recusado')
      );
      query
        .mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never)
        .mockResolvedValueOnce({
          rows: [buildRow('REJECTED', 150, 'PayPal recusou o meio de pagamento (INSTRUMENT_DECLINED)')],
          rowCount: 1,
        } as never);

      const res = await request(app)
        .post(`/api/v1/payments/order/${ORDER_ID}/paypal/approve`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ decision: 'DECLINE' });

      expect(res.status).toBe(200);
      expect(res.body.data.payment.status).toBe('REJECTED');
      expect(broker.publish).toHaveBeenCalledWith('payment.rejected', expect.anything());
    });

    it('deve responder 503 rápido com o circuit breaker aberto', async () => {
      // Abre o circuito: falhas seguidas do gateway
      for (let i = 0; i < 5; i++) {
        await paypalBreaker
          .exec(async () => {
            throw new PayPalUnavailableError('HTTP 503');
          })
          .catch(() => undefined);
      }
      expect(paypalBreaker.getState()).toBe('OPEN');

      query.mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const res = await request(app)
        .post(`/api/v1/payments/order/${ORDER_ID}/paypal/approve`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.message).toContain('circuit breaker aberto');
      // Nem tentou falar com o gateway
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('deve republicar o resultado se o pagamento já estiver finalizado', async () => {
      const capture = vi.spyOn(paypalClient, 'captureOrder');
      query.mockResolvedValueOnce({ rows: [buildRow('APPROVED', 150)], rowCount: 1 } as never);

      const res = await request(app)
        .post(`/api/v1/payments/order/${ORDER_ID}/paypal/approve`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(capture).not.toHaveBeenCalled();
      expect(broker.publish).toHaveBeenCalledWith('payment.approved', expect.anything());
    });

    it('deve impedir que outro usuário aprove o pagamento', async () => {
      const other = jwt.sign({ userId: 'intruso', email: 'x@x.com', role: 'ROLE_CUSTOMER' }, env.JWT_SECRET);
      query.mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never);

      const res = await request(app)
        .post(`/api/v1/payments/order/${ORDER_ID}/paypal/approve`)
        .set('Authorization', `Bearer ${other}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  describe('Cancelamento pelo comprador (POST /paypal/cancel)', () => {
    it('deve recusar o pagamento e publicar payment.rejected', async () => {
      query
        .mockResolvedValueOnce({ rows: [buildRow('PENDING_APPROVAL', 150)], rowCount: 1 } as never)
        .mockResolvedValueOnce({
          rows: [buildRow('REJECTED', 150, 'pagamento cancelado pelo comprador no PayPal')],
          rowCount: 1,
        } as never);

      const res = await request(app)
        .post(`/api/v1/payments/order/${ORDER_ID}/paypal/cancel`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.payment.status).toBe('REJECTED');
      expect(broker.publish).toHaveBeenCalledWith('payment.rejected', expect.anything());
    });
  });
});

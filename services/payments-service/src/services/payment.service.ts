import { randomUUID } from 'node:crypto';
import { pool } from '../config/database';
import { env } from '../config/env';
import { Payment, PaymentMethod, PaymentStatus } from '../models/payment.model';
import { AppError } from '../middlewares/error.middleware';
import { OrderCreatedEvent } from '../messaging/events';
import { paymentPublisher } from '../messaging/payment.publisher';
import { PayPalApiError, paypalClient } from '../paypal/paypal.client';
import { CircuitOpenError } from '../resilience/circuit-breaker';

// Falha temporaria do gateway, do tipo que resolve sozinha tentando de novo.
// Lancar isso no consumer faz o broker reagendar a mensagem. Diferente de
// uma recusa, que e decisao de negocio e nao adianta repetir.
export class TransientPaymentError extends Error {}

export interface ProcessResult {
  payment: Payment;
  // false quando o pagamento ja existia e o broker so reentregou
  created: boolean;
}

export type PayerDecision = 'APPROVE' | 'DECLINE';

const COLUMNS = `id, order_id, user_id, amount, status, method, reason, attempts,
  paypal_order_id, paypal_capture_id, created_at, updated_at`;

// Fluxo PayPal (simulado):
//
//   order.created ──> process(): cria a ordem no PayPal ──> PENDING_APPROVAL
//                                                              │
//   comprador clica "Pagar com PayPal" no frontend             │
//   POST /payments/order/:id/paypal/approve ──> captura ──> APPROVED ──> payment.approved
//                                          └──> recusa  ──> REJECTED ──> payment.rejected
//   POST /payments/order/:id/paypal/cancel  ─────────────> REJECTED ──> payment.rejected
//
// Todas as chamadas ao PayPal passam pelo circuit breaker "paypal-gateway".
export class PaymentService {
  async process(event: OrderCreatedEvent, attempt: number): Promise<ProcessResult> {
    const existing = await this.findByOrderId(event.orderId);
    if (existing) {
      return { payment: existing, created: false };
    }

    // Recusa por valor: regra da loja, nem chega a falar com o PayPal
    if (event.totalAmount > env.PAYMENT_MAX_AMOUNT) {
      const payment = await this.persist({
        orderId: event.orderId,
        userId: event.userId,
        amount: event.totalAmount,
        status: 'REJECTED',
        reason: `valor acima do limite autorizado de R$ ${env.PAYMENT_MAX_AMOUNT.toFixed(2)}`,
        attempts: attempt,
        paypalOrderId: null,
      });
      return { payment, created: true };
    }

    let paypalOrderId: string;
    try {
      const order = await paypalClient.createOrder(event.orderId, event.totalAmount);
      paypalOrderId = order.id;
    } catch (err) {
      if (err instanceof PayPalApiError) {
        // O PayPal recusou a ordem (dados invalidos, moeda, etc.): definitivo
        const payment = await this.persist({
          orderId: event.orderId,
          userId: event.userId,
          amount: event.totalAmount,
          status: 'REJECTED',
          reason: err.message,
          attempts: attempt,
          paypalOrderId: null,
        });
        return { payment, created: true };
      }

      // Gateway fora, lento ou circuito aberto: nada gravado, o RabbitMQ
      // reentrega depois pela fila de retry. Com o breaker aberto isso nem
      // gasta uma chamada HTTP.
      const motivo = err instanceof CircuitOpenError ? 'circuit breaker aberto' : (err as Error).message;
      throw new TransientPaymentError(
        `gateway PayPal indisponível (tentativa ${attempt}): ${motivo}`
      );
    }

    const payment = await this.persist({
      orderId: event.orderId,
      userId: event.userId,
      amount: event.totalAmount,
      status: 'PENDING_APPROVAL',
      reason: null,
      attempts: attempt,
      paypalOrderId,
    });

    return { payment, created: true };
  }

  // O comprador "aprovou" na tela do PayPal (simulada no frontend).
  // decision = DECLINE simula o cartao/saldo sendo recusado na captura.
  async approve(
    orderId: string,
    userId: string,
    role: string | undefined,
    decision: PayerDecision,
    method: PaymentMethod = 'PAYPAL'
  ): Promise<Payment> {
    const payment = await this.getByOrderId(orderId, userId, role);

    // Ja finalizado: so republica o resultado. Cobre o caso em que a
    // captura deu certo mas o publish falhou na chamada anterior.
    if (payment.status !== 'PENDING_APPROVAL') {
      await this.publishOrFail(payment);
      return payment;
    }

    if (!payment.paypal_order_id) {
      throw new AppError(409, 'Pagamento sem ordem PayPal associada');
    }

    let finalized: Payment;
    try {
      await paypalClient.simulatePayerApproval(payment.paypal_order_id, decision);
      const captured = await paypalClient.captureOrder(payment.paypal_order_id);
      const captureId =
        captured.purchase_units[0]?.payments?.captures?.[0]?.id ?? null;
      finalized = await this.finalize(orderId, 'APPROVED', null, captureId, method);
    } catch (err) {
      if (err instanceof PayPalApiError) {
        if (err.issue === 'ORDER_ALREADY_CAPTURED') {
          finalized = await this.finalize(orderId, 'APPROVED', null, null, method);
        } else {
          const reason =
            err.issue === 'INSTRUMENT_DECLINED'
              ? 'Meio de pagamento recusado (INSTRUMENT_DECLINED)'
              : err.message;
          finalized = await this.finalize(orderId, 'REJECTED', reason, null, method);
        }
      } else if (err instanceof CircuitOpenError) {
        throw new AppError(
          503,
          `Gateway PayPal temporariamente indisponível (circuit breaker aberto). ` +
            `Tente novamente em ${Math.ceil(err.retryAfterMs / 1000)}s.`,
          { circuitBreaker: err.breaker, retryAfterMs: err.retryAfterMs }
        );
      } else {
        throw new AppError(502, `Falha ao falar com o gateway PayPal: ${(err as Error).message}`);
      }
    }

    await this.publishOrFail(finalized);
    return finalized;
  }

  // Comprador desistiu na tela do PayPal
  async cancel(orderId: string, userId: string, role?: string): Promise<Payment> {
    const payment = await this.getByOrderId(orderId, userId, role);

    if (payment.status !== 'PENDING_APPROVAL') {
      await this.publishOrFail(payment);
      return payment;
    }

    const finalized = await this.finalize(
      orderId,
      'REJECTED',
      'pagamento cancelado pelo comprador no PayPal',
      null
    );
    await this.publishOrFail(finalized);
    return finalized;
  }

  // O pagamento ja esta salvo. Se o broker estiver fora, avisamos o cliente
  // para tentar de novo: a proxima chamada cai no "ja finalizado" e republica.
  private async publishOrFail(payment: Payment): Promise<void> {
    try {
      await paymentPublisher.publishResult(payment);
    } catch (err) {
      console.error(
        `[payments-service] Pagamento ${payment.id} salvo como ${payment.status}, ` +
          `mas o evento não foi publicado: ${(err as Error).message}`
      );
      throw new AppError(
        503,
        'Pagamento registrado, mas o pedido ainda não foi notificado. Tente novamente em instantes.'
      );
    }
  }

  // Sai de PENDING_APPROVAL uma unica vez. Se duas abas clicarem ao mesmo
  // tempo, so uma faz o UPDATE; a outra recebe o que a primeira gravou.
  private async finalize(
    orderId: string,
    status: Exclude<PaymentStatus, 'PENDING_APPROVAL'>,
    reason: string | null,
    captureId: string | null,
    method?: PaymentMethod
  ): Promise<Payment> {
    const result = await pool.query(
      `UPDATE payments
       SET status = $1, reason = $2, paypal_capture_id = COALESCE($3, paypal_capture_id),
           method = COALESCE($5, method), updated_at = CURRENT_TIMESTAMP
       WHERE order_id = $4 AND status = 'PENDING_APPROVAL'
       RETURNING ${COLUMNS}`,
      [status, reason, captureId, orderId, method ?? null]
    );

    if (result.rowCount === 0) {
      const current = await this.findByOrderId(orderId);
      if (!current) throw new AppError(404, 'Pagamento não encontrado para este pedido');
      return current;
    }

    console.log(`[payments-service] Pagamento do pedido ${orderId} finalizado como ${status}`);
    return this.mapRow(result.rows[0]);
  }

  private async persist(data: {
    orderId: string;
    userId: string;
    amount: number;
    status: PaymentStatus;
    reason: string | null;
    attempts: number;
    paypalOrderId: string | null;
  }): Promise<Payment> {
    const query = `
      INSERT INTO payments (id, order_id, user_id, amount, status, method, reason, attempts, paypal_order_id)
      VALUES ($1, $2, $3, $4, $5, 'PAYPAL', $6, $7, $8)
      ON CONFLICT (order_id) DO NOTHING
      RETURNING ${COLUMNS}
    `;
    const result = await pool.query(query, [
      randomUUID(),
      data.orderId,
      data.userId,
      data.amount.toFixed(2),
      data.status,
      data.reason,
      data.attempts,
      data.paypalOrderId,
    ]);

    // Com mais de uma replica do servico, dois consumidores podem pegar o
    // mesmo pedido. Quem perdeu o INSERT aceita o pagamento do outro.
    if (result.rowCount === 0) {
      const winner = await this.findByOrderId(data.orderId);
      if (!winner) {
        throw new Error(`Falha ao persistir pagamento do pedido ${data.orderId}`);
      }
      return winner;
    }

    return this.mapRow(result.rows[0]);
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const result = await pool.query(`SELECT ${COLUMNS} FROM payments WHERE order_id = $1`, [orderId]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async getByOrderId(orderId: string, userId: string, role?: string): Promise<Payment> {
    const payment = await this.findByOrderId(orderId);

    if (!payment) {
      throw new AppError(404, 'Pagamento não encontrado para este pedido');
    }

    if (payment.user_id !== userId && role !== 'ROLE_ADMIN') {
      throw new AppError(403, 'Acesso não autorizado a este pagamento');
    }

    return payment;
  }

  async listByUser(userId: string): Promise<Payment[]> {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM payments WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Record<string, unknown>): Payment {
    return {
      id: row.id as string,
      order_id: row.order_id as string,
      user_id: row.user_id as string,
      amount: Number(row.amount),
      status: row.status as PaymentStatus,
      method: ((row.method as string) ?? 'PAYPAL') as Payment['method'],
      reason: (row.reason as string | null) ?? null,
      attempts: Number(row.attempts),
      paypal_order_id: (row.paypal_order_id as string | null) ?? null,
      paypal_capture_id: (row.paypal_capture_id as string | null) ?? null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}

export const paymentService = new PaymentService();

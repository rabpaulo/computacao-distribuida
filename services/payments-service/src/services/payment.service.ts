import { randomUUID } from 'node:crypto';
import { pool } from '../config/database';
import { env } from '../config/env';
import { Payment, PaymentStatus } from '../models/payment.model';
import { AppError } from '../middlewares/error.middleware';
import { OrderCreatedEvent } from '../messaging/events';

// Falha temporaria do gateway, do tipo que resolve sozinha tentando de novo.
// Lancar isso no consumer faz o broker reagendar a mensagem. Diferente de
// uma recusa, que e decisao de negocio e nao adianta repetir.
export class TransientPaymentError extends Error {}

export interface ProcessResult {
  payment: Payment;
  // false quando o pagamento ja existia e o broker so reentregou
  created: boolean;
}

export class PaymentService {
  async process(event: OrderCreatedEvent, attempt: number): Promise<ProcessResult> {
    const existing = await this.findByOrderId(event.orderId);
    if (existing) {
      return { payment: existing, created: false };
    }

    // Gateway de verdade demora. E justamente por isso que o pagamento
    // nao pode travar o checkout.
    if (env.PAYMENT_LATENCY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.PAYMENT_LATENCY_MS));
    }

    // Caso 1: o gateway caiu. Nada e gravado, o broker reentrega depois.
    if (Math.random() < env.PAYMENT_FAILURE_RATE) {
      throw new TransientPaymentError(
        `gateway de pagamento indisponivel (tentativa ${attempt})`
      );
    }

    // Caso 2: recusa por valor. Grava REJECTED e encerra, sem retentativa.
    if (event.totalAmount > env.PAYMENT_MAX_AMOUNT) {
      const payment = await this.persist({
        orderId: event.orderId,
        userId: event.userId,
        amount: event.totalAmount,
        status: 'REJECTED',
        reason: `valor acima do limite autorizado de R$ ${env.PAYMENT_MAX_AMOUNT.toFixed(2)}`,
        attempts: attempt,
      });
      return { payment, created: true };
    }

    // Caso 3: passou
    const payment = await this.persist({
      orderId: event.orderId,
      userId: event.userId,
      amount: event.totalAmount,
      status: 'APPROVED',
      reason: null,
      attempts: attempt,
    });

    return { payment, created: true };
  }

  private async persist(data: {
    orderId: string;
    userId: string;
    amount: number;
    status: PaymentStatus;
    reason: string | null;
    attempts: number;
  }): Promise<Payment> {
    const query = `
      INSERT INTO payments (id, order_id, user_id, amount, status, reason, attempts)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (order_id) DO NOTHING
      RETURNING id, order_id, user_id, amount, status, reason, attempts, created_at, updated_at
    `;
    const result = await pool.query(query, [
      randomUUID(),
      data.orderId,
      data.userId,
      data.amount.toFixed(2),
      data.status,
      data.reason,
      data.attempts,
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
    const query = `
      SELECT id, order_id, user_id, amount, status, reason, attempts, created_at, updated_at
      FROM payments
      WHERE order_id = $1
    `;
    const result = await pool.query(query, [orderId]);
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
    const query = `
      SELECT id, order_id, user_id, amount, status, reason, attempts, created_at, updated_at
      FROM payments
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Record<string, unknown>): Payment {
    return {
      id: row.id as string,
      order_id: row.order_id as string,
      user_id: row.user_id as string,
      amount: Number(row.amount),
      status: row.status as PaymentStatus,
      reason: (row.reason as string | null) ?? null,
      attempts: Number(row.attempts),
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}

export const paymentService = new PaymentService();

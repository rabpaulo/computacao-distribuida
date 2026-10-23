import { randomUUID } from 'node:crypto';
import { broker } from './index';
import { ROUTING_KEYS } from './config';
import { PaymentProcessedEvent } from './events';
import { Payment } from '../models/payment.model';

export class PaymentPublisher {
  // Devolve o resultado pro orders-service.
  // Diferente do order.created, o erro aqui sobe: sem esse evento o pedido
  // trava em PENDING, entao e melhor o broker reentregar e tentar de novo.
  async publishResult(payment: Payment): Promise<void> {
    const routingKey =
      payment.status === 'APPROVED'
        ? ROUTING_KEYS.PAYMENT_APPROVED
        : ROUTING_KEYS.PAYMENT_REJECTED;

    const event: PaymentProcessedEvent = {
      eventId: randomUUID(),
      eventType: routingKey === ROUTING_KEYS.PAYMENT_APPROVED
        ? 'payment.approved'
        : 'payment.rejected',
      occurredAt: new Date().toISOString(),
      orderId: payment.order_id,
      paymentId: payment.id,
      amount: payment.amount,
      ...(payment.reason ? { reason: payment.reason } : {}),
    };

    await broker.publish(routingKey, event);
    console.log(
      `[payments-service] Evento ${routingKey} publicado para o pedido ${payment.order_id}`
    );
  }
}

export const paymentPublisher = new PaymentPublisher();

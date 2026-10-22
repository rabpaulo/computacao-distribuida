import { randomUUID } from 'node:crypto';
import { broker } from './index';
import { ROUTING_KEYS } from './config';
import { OrderCreatedEvent } from './events';
import { Order } from '../models/order.model';

export class OrderPublisher {
  // Avisa que tem pedido novo esperando pagamento.
  // Se o broker estiver fora nos apenas registramos o erro: o pedido ja foi
  // salvo como PENDING e nao faz sentido derrubar o checkout do cliente
  // por causa disso.
  async publishOrderCreated(order: Order): Promise<void> {
    const event: OrderCreatedEvent = {
      eventId: randomUUID(),
      eventType: 'order.created',
      occurredAt: new Date().toISOString(),
      orderId: order.id,
      userId: order.user_id,
      totalAmount: order.total_amount,
      items: (order.items ?? []).map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        price: Number(item.price),
        quantity: item.quantity,
      })),
    };

    try {
      await broker.publish(ROUTING_KEYS.ORDER_CREATED, event);
      console.log(`[orders-service] Evento order.created publicado para o pedido ${order.id}`);
    } catch (err) {
      console.error(
        `[orders-service] Nao foi possivel publicar order.created do pedido ${order.id}:`,
        (err as Error).message
      );
    }
  }
}

export const orderPublisher = new OrderPublisher();

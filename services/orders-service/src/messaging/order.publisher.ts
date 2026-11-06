import { randomUUID } from 'node:crypto';
import { broker } from './index';
import { ROUTING_KEYS } from './config';
import { OrderConfirmedEvent, OrderCreatedEvent } from './events';
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
      ...this.orderPayload(order),
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

  // Avisa a logistica que o pedido pode ser despachado. Ao contrario do
  // order.created, aqui o erro sobe: quem chama e o consumidor da fila, e
  // deixar o broker reentregar e o jeito de nao perder a entrega.
  async publishOrderConfirmed(order: Order): Promise<void> {
    const event: OrderConfirmedEvent = {
      eventId: randomUUID(),
      eventType: 'order.confirmed',
      occurredAt: new Date().toISOString(),
      ...this.orderPayload(order),
    };

    await broker.publish(ROUTING_KEYS.ORDER_CONFIRMED, event);
    console.log(`[orders-service] Evento order.confirmed publicado para o pedido ${order.id}`);
  }

  private orderPayload(order: Order) {
    return {
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
  }
}

export const orderPublisher = new OrderPublisher();

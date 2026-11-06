import { broker } from './index';
import { QUEUES, ROUTING_KEYS } from './config';
import { orderConfirmedSchema } from './events';
import { shipmentService } from '../container';

// Pedido pago e confirmado pelo orders-service: abre a entrega e despacha
// para um caminhao via MQTT.
export async function registerOrderConfirmedConsumer(): Promise<void> {
  await broker.subscribe(
    QUEUES.LOGISTICS_ORDER_CONFIRMED,
    [ROUTING_KEYS.ORDER_CONFIRMED],
    async (payload, routingKey) => {
      const parsed = orderConfirmedSchema.safeParse(payload);

      if (!parsed.success) {
        throw new Error(
          `Evento ${routingKey} com payload inválido: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        );
      }

      await shipmentService.createFromOrder(parsed.data);
    }
  );
}

import { broker } from './index';
import { QUEUES, ROUTING_KEYS } from './config';
import { paymentProcessedSchema } from './events';
import { orderService } from '../services/order.service';
import { orderPublisher } from './order.publisher';

// Escuta a resposta do payments-service e fecha o ciclo: o pedido sai de
// PENDING e vira CONFIRMED ou CANCELLED.
export async function registerPaymentConsumer(): Promise<void> {
  await broker.subscribe(
    QUEUES.ORDERS_PAYMENT_PROCESSED,
    [ROUTING_KEYS.PAYMENT_APPROVED, ROUTING_KEYS.PAYMENT_REJECTED],
    async (payload, routingKey) => {
      const parsed = paymentProcessedSchema.safeParse(payload);

      if (!parsed.success) {
        // Payload torto nao melhora tentando de novo, mas lancamos o erro
        // assim mesmo para a mensagem cair na DLQ e o problema aparecer.
        throw new Error(
          `Evento ${routingKey} com payload inválido: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        );
      }

      const event = parsed.data;
      const newStatus = event.eventType === 'payment.approved' ? 'CONFIRMED' : 'CANCELLED';

      const updated = await orderService.applyPaymentResult(
        event.orderId,
        newStatus,
        event.reason
      );

      if (updated) {
        console.log(
          `[orders-service] Pedido ${event.orderId} atualizado para ${newStatus} ` +
            `(pagamento ${event.paymentId}).`
        );
      } else {
        console.log(
          `[orders-service] Pedido ${event.orderId} já estava finalizado. Evento ignorado.`
        );
      }

      // Pedido confirmado vai pra logistica. Roda tambem na reentrega
      // (updated = false): se o publish anterior falhou, e aqui que ele sai.
      // O logistics-service ignora duplicata pelo order_id.
      if (newStatus === 'CONFIRMED') {
        const order = await orderService.findWithItems(event.orderId);
        if (order?.status === 'CONFIRMED') {
          await orderPublisher.publishOrderConfirmed(order);
        }
      }
    }
  );
}

import { broker } from './index';
import { QUEUES, ROUTING_KEYS } from './config';
import { orderCreatedSchema } from './events';
import { paymentService } from '../services/payment.service';
import { paymentPublisher } from './payment.publisher';

// Aqui o pagamento acontece de fato, fora da requisicao HTTP do checkout.
// O cliente ja recebeu a resposta ha varios segundos quando isso roda.
export async function registerOrderConsumer(): Promise<void> {
  await broker.subscribe(
    QUEUES.PAYMENTS_ORDER_CREATED,
    [ROUTING_KEYS.ORDER_CREATED],
    async (payload, routingKey, meta) => {
      const parsed = orderCreatedSchema.safeParse(payload);

      if (!parsed.success) {
        throw new Error(
          `Evento ${routingKey} com payload inválido: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        );
      }

      const event = parsed.data;
      const attempt = meta.retryCount + 1;

      console.log(
        `[payments-service] Processando pagamento do pedido ${event.orderId} ` +
          `(R$ ${event.totalAmount.toFixed(2)}, tentativa ${attempt}).`
      );

      // Erro daqui pra baixo sobe pro broker, que reagenda ou manda pra DLQ
      const { payment, created } = await paymentService.process(event, attempt);

      if (!created) {
        console.log(
          `[payments-service] Pedido ${event.orderId} já possui pagamento ` +
            `${payment.status}. Republicando resultado.`
        );
      }

      // Publicamos mesmo quando o pagamento ja existia. Se a primeira
      // publicacao tiver falhado, e assim que o pedido sai do PENDING.
      await paymentPublisher.publishResult(payment);
    }
  );
}

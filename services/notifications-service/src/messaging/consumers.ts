import { z } from 'zod';
import { broker } from './index';
import { NOTIFICATION_ROUTING_KEYS, QUEUES } from './config';
import {
  orderConfirmedSchema,
  orderCreatedSchema,
  paymentProcessedSchema,
  shipmentEventSchema,
  userDeletedSchema,
} from './events';
import { NewNotification, NotificationService } from '../services/notification.service';

// Pedido de 8 caracteres é o suficiente para o cliente se achar na lista
const shortId = (id: string): string => id.slice(0, 8).toUpperCase();

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// O motivo da recusa vem do payments-service; limitamos o tamanho por segurança
const clip = (text: string, max = 140): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  routingKey: string
): z.infer<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Lançar faz o broker reagendar o evento e, esgotadas as tentativas, mandar para a DLQ
    throw new Error(
      `Evento ${routingKey} com payload inválido: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return parsed.data;
}

// Traduz um evento de domínio na ação deste serviço. Fica separado do broker
// para ser testado sem RabbitMQ.
export async function handleEvent(
  service: NotificationService,
  payload: unknown,
  routingKey: string
): Promise<void> {
  switch (routingKey) {
    case 'order.created': {
      const event = parseOrThrow(orderCreatedSchema, payload, routingKey);
      // Os eventos de pagamento não trazem o userId: guardamos o dono do pedido
      await service.rememberOrderOwner(event.orderId, event.userId);
      await service.create({
        eventId: event.eventId,
        userId: event.userId,
        orderId: event.orderId,
        type: 'ORDER_CREATED',
        level: 'info',
        title: 'Pedido recebido',
        message: `Recebemos o pedido #${shortId(event.orderId)} (${brl.format(event.totalAmount)}). Aguardando a confirmação do pagamento.`,
      });
      return;
    }

    case 'payment.approved':
    case 'payment.rejected': {
      const event = parseOrThrow(paymentProcessedSchema, payload, routingKey);
      const userId = await service.findOrderOwner(event.orderId);
      if (!userId) {
        // order.created ainda não foi processado (ou foi perdido): tenta de novo mais tarde
        throw new Error(`Dono do pedido ${event.orderId} ainda desconhecido`);
      }

      const approved = event.eventType === 'payment.approved';
      const notification: NewNotification = approved
        ? {
            eventId: event.eventId,
            userId,
            orderId: event.orderId,
            type: 'PAYMENT_APPROVED',
            level: 'success',
            title: 'Pagamento aprovado',
            message: `O pagamento de ${brl.format(event.amount)} do pedido #${shortId(event.orderId)} foi aprovado.`,
          }
        : {
            eventId: event.eventId,
            userId,
            orderId: event.orderId,
            type: 'PAYMENT_REJECTED',
            level: 'error',
            title: 'Pagamento recusado',
            message: `O pagamento do pedido #${shortId(event.orderId)} foi recusado${
              event.reason ? `: ${clip(event.reason)}` : '.'
            }`,
          };
      await service.create(notification);
      return;
    }

    case 'order.confirmed': {
      const event = parseOrThrow(orderConfirmedSchema, payload, routingKey);
      await service.create({
        eventId: event.eventId,
        userId: event.userId,
        orderId: event.orderId,
        type: 'ORDER_CONFIRMED',
        level: 'success',
        title: 'Pedido confirmado',
        message: `O pedido #${shortId(event.orderId)} foi confirmado e está sendo preparado para entrega.`,
      });
      return;
    }

    case 'shipment.assigned':
    case 'shipment.in_transit':
    case 'shipment.delivered': {
      const event = parseOrThrow(shipmentEventSchema, payload, routingKey);
      const base = {
        eventId: event.eventId,
        userId: event.userId,
        orderId: event.orderId,
      };
      const order = `#${shortId(event.orderId)}`;

      if (event.eventType === 'shipment.assigned') {
        await service.create({
          ...base,
          type: 'SHIPMENT_ASSIGNED',
          level: 'info',
          title: 'Entrega despachada',
          message: `O pedido ${order} foi despachado${event.truckId ? ` no caminhão ${event.truckId}` : ''}.`,
        });
      } else if (event.eventType === 'shipment.in_transit') {
        await service.create({
          ...base,
          type: 'SHIPMENT_IN_TRANSIT',
          level: 'info',
          title: 'Pedido a caminho',
          message: `O pedido ${order} saiu do centro de distribuição e está a caminho.`,
        });
      } else {
        await service.create({
          ...base,
          type: 'SHIPMENT_DELIVERED',
          level: 'success',
          title: 'Pedido entregue',
          message: `O pedido ${order} foi entregue. Obrigado por comprar no DistriCommerce!`,
        });
      }
      return;
    }

    case 'user.deleted': {
      // LGPD: o titular pediu a exclusão da conta, então apagamos o que temos dele
      const event = parseOrThrow(userDeletedSchema, payload, routingKey);
      const removed = await service.deleteUserData(event.userId);
      console.log(
        `[notifications-service] Exclusão LGPD: ${removed.notifications} notificação(ões) e ` +
          `${removed.orders} vínculo(s) de pedido removidos.`
      );
      return;
    }

    default:
      console.warn(`[notifications-service] Evento sem tratamento ignorado: ${routingKey}`);
  }
}

export async function registerEventConsumer(service: NotificationService): Promise<void> {
  await broker.subscribe(QUEUES.NOTIFICATIONS_EVENTS, NOTIFICATION_ROUTING_KEYS, (payload, routingKey) =>
    handleEvent(service, payload, routingKey)
  );
}

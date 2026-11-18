import { z } from 'zod';

// Formato das mensagens que este serviço consome. Validamos com Zod na chegada
// porque mensagem de fila pode ser antiga, de uma versão anterior do serviço
// que publicou, ou simplesmente vir torta. Só declaramos os campos que usamos:
// o Zod ignora o resto, então os outros serviços podem evoluir o evento sem
// quebrar este consumidor.

const envelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
});

// orders-service: pedido criado, aguardando pagamento
export const orderCreatedSchema = envelopeSchema.extend({
  eventType: z.literal('order.created'),
  orderId: z.string().uuid(),
  userId: z.string().min(1),
  totalAmount: z.number().nonnegative(),
});

// orders-service: pagamento aprovado, pedido confirmado
export const orderConfirmedSchema = envelopeSchema.extend({
  eventType: z.literal('order.confirmed'),
  orderId: z.string().uuid(),
  userId: z.string().min(1),
  totalAmount: z.number().nonnegative(),
});

// payments-service. Não traz o userId: o dono vem de order.created
export const paymentProcessedSchema = envelopeSchema.extend({
  eventType: z.enum(['payment.approved', 'payment.rejected']),
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().nonnegative(),
  reason: z.string().optional(),
});

// logistics-service: mudanças de status da entrega
export const shipmentEventSchema = envelopeSchema.extend({
  eventType: z.enum(['shipment.assigned', 'shipment.in_transit', 'shipment.delivered']),
  shipmentId: z.string().uuid(),
  orderId: z.string().uuid(),
  userId: z.string().min(1),
  truckId: z.string().nullable().optional(),
});

// users-service: titular pediu a exclusão da conta (LGPD)
export const userDeletedSchema = envelopeSchema.extend({
  eventType: z.literal('user.deleted'),
  userId: z.string().min(1),
});

export type OrderCreatedEvent = z.infer<typeof orderCreatedSchema>;
export type OrderConfirmedEvent = z.infer<typeof orderConfirmedSchema>;
export type PaymentProcessedEvent = z.infer<typeof paymentProcessedSchema>;
export type ShipmentEvent = z.infer<typeof shipmentEventSchema>;
export type UserDeletedEvent = z.infer<typeof userDeletedSchema>;

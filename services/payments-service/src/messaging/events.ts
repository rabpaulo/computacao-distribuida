import { z } from 'zod';

// Formato das mensagens que trafegam pelo broker.
// Validamos com Zod na chegada porque mensagem de fila pode ser antiga,
// de uma versao anterior do servico, ou simplesmente vir torta.

const envelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export const orderCreatedSchema = envelopeSchema.extend({
  eventType: z.literal('order.created'),
  orderId: z.string().uuid(),
  userId: z.string().min(1),
  totalAmount: z.number().nonnegative(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        productName: z.string().min(1),
        price: z.number().nonnegative(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

export const paymentProcessedSchema = envelopeSchema.extend({
  eventType: z.enum(['payment.approved', 'payment.rejected']),
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().nonnegative(),
  // So vem preenchido quando o pagamento e recusado
  reason: z.string().optional(),
});

export type OrderCreatedEvent = z.infer<typeof orderCreatedSchema>;
export type PaymentProcessedEvent = z.infer<typeof paymentProcessedSchema>;

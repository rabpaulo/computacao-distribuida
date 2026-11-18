// Nomes de exchange, fila e routing key deste serviço.
// Os três exchanges e a DLQ são os mesmos dos outros serviços (orders, payments,
// logistics): declarar de novo o que já existe, com os mesmos argumentos, não dá
// erro no AMQP. A fila de notificações é só deste serviço.

export const EXCHANGES = {
  // Por onde passam todos os eventos de domínio
  EVENTS: 'districommerce.events',
  // Alimenta as filas de retentativa (routing key = nome da fila de origem)
  RETRY: 'districommerce.retry',
  // Dead letter: o que falhou de vez
  DLX: 'districommerce.dlx',
} as const;

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  // Curinga do AMQP: payment.approved e payment.rejected
  PAYMENT_ALL: 'payment.*',
  // Publicados pelo logistics-service: shipment.assigned, shipment.in_transit, shipment.delivered
  SHIPMENT_ALL: 'shipment.*',
  // Publicado pelo users-service quando o titular pede a exclusão da conta (LGPD)
  USER_DELETED: 'user.deleted',
} as const;

// Tudo que a fila de notificações escuta
export const NOTIFICATION_ROUTING_KEYS: string[] = [
  ROUTING_KEYS.ORDER_CREATED,
  ROUTING_KEYS.ORDER_CONFIRMED,
  ROUTING_KEYS.PAYMENT_ALL,
  ROUTING_KEYS.SHIPMENT_ALL,
  ROUTING_KEYS.USER_DELETED,
];

export const QUEUES = {
  NOTIFICATIONS_EVENTS: 'notifications.events',
  // Fila com TTL que devolve a mensagem para a fila de origem depois do delay
  NOTIFICATIONS_EVENTS_RETRY: 'notifications.events.retry',
  DEAD_LETTER: 'districommerce.dlq',
} as const;

// Contador de retentativas, viaja junto com a mensagem
export const RETRY_COUNT_HEADER = 'x-retry-count';

// A fila de retry devolve a mensagem direto pra fila de origem (exchange
// default), e nisso a routing key vira o nome da fila. A original vai aqui.
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-original-routing-key';

// Guarda o último erro quando a mensagem vai pra DLQ
export const ERROR_HEADER = 'x-error-message';

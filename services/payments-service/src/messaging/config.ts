// Nomes de exchange, fila e routing key ficam todos aqui para os servicos
// usarem as mesmas constantes e nao sair string solta pelo codigo.
// O arquivo e identico no orders-service, payments-service e logistics-service.

export const EXCHANGES = {
  // Por onde passam todos os eventos de dominio
  EVENTS: 'districommerce.events',
  // Alimenta as filas de retentativa (routing key = nome da fila de origem)
  RETRY: 'districommerce.retry',
  // Dead letter: o que falhou de vez
  DLX: 'districommerce.dlx',
} as const;

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  // Pagamento aprovado e pedido confirmado: hora de despachar
  ORDER_CONFIRMED: 'order.confirmed',
  PAYMENT_APPROVED: 'payment.approved',
  PAYMENT_REJECTED: 'payment.rejected',
  // Curinga do AMQP, pega approved e rejected de uma vez
  PAYMENT_ALL: 'payment.*',
} as const;

export const QUEUES = {
  PAYMENTS_ORDER_CREATED: 'payments.order-created',
  // Fila com TTL que devolve a mensagem pro exchange principal depois do delay
  PAYMENTS_ORDER_CREATED_RETRY: 'payments.order-created.retry',
  ORDERS_PAYMENT_PROCESSED: 'orders.payment-processed',
  ORDERS_PAYMENT_PROCESSED_RETRY: 'orders.payment-processed.retry',
  LOGISTICS_ORDER_CONFIRMED: 'logistics.order-confirmed',
  LOGISTICS_ORDER_CONFIRMED_RETRY: 'logistics.order-confirmed.retry',
  DEAD_LETTER: 'districommerce.dlq',
} as const;

// Contador de retentativas, viaja junto com a mensagem
export const RETRY_COUNT_HEADER = 'x-retry-count';

// A fila de retry devolve a mensagem direto pra fila de origem (exchange
// default), e nisso a routing key vira o nome da fila. A original vai aqui.
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-original-routing-key';

// Guarda o ultimo erro quando a mensagem vai pra DLQ
export const ERROR_HEADER = 'x-error-message';

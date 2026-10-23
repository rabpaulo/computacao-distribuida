// Nomes de exchange, fila e routing key ficam todos aqui para os dois
// servicos usarem as mesmas constantes e nao sair string solta pelo codigo.

export const EXCHANGES = {
  // Por onde passam todos os eventos de dominio
  EVENTS: 'districommerce.events',
  // Alimenta a fila de retentativa
  RETRY: 'districommerce.retry',
  // Dead letter: o que falhou de vez
  DLX: 'districommerce.dlx',
} as const;

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
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
  DEAD_LETTER: 'districommerce.dlq',
} as const;

// Contador de retentativas, viaja junto com a mensagem
export const RETRY_COUNT_HEADER = 'x-retry-count';

// Guarda o ultimo erro quando a mensagem vai pra DLQ
export const ERROR_HEADER = 'x-error-message';

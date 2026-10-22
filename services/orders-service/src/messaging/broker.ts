import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import {
  ERROR_HEADER,
  EXCHANGES,
  QUEUES,
  RETRY_COUNT_HEADER,
  ROUTING_KEYS,
} from './config';

// Cliente RabbitMQ usado pelo orders-service e pelo payments-service.
// O arquivo e o mesmo nos dois de proposito: se a topologia divergir entre
// as pontas, a declaracao da fila conflita e o servico nem sobe.

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;

export interface BrokerOptions {
  url: string;
  serviceName: string;
  // Quantas mensagens o consumidor pega antes de dar ack
  prefetch: number;
  // Tentativas antes de desistir e mandar pra DLQ
  maxRetries: number;
  // Quanto tempo a mensagem espera na fila de retry
  retryDelayMs: number;
}

export interface DeliveryMeta {
  // Zero na primeira entrega
  retryCount: number;
  messageId?: string;
}

// Se o handler lancar erro, a mensagem e reagendada. Se retornar, dá ack.
export type EventHandler = (
  payload: unknown,
  routingKey: string,
  meta: DeliveryMeta
) => Promise<void>;

interface Subscription {
  queue: string;
  routingKeys: string[];
  handler: EventHandler;
}

export class RabbitBroker {
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private readonly subscriptions: Subscription[] = [];
  private connecting: Promise<void> | null = null;
  private closed = false;
  private reconnectAttempts = 0;

  constructor(private readonly options: BrokerOptions) {}

  private log(message: string, ...rest: unknown[]): void {
    console.log(`[${this.options.serviceName}][rabbitmq] ${message}`, ...rest);
  }

  private warn(message: string, ...rest: unknown[]): void {
    console.warn(`[${this.options.serviceName}][rabbitmq] ${message}`, ...rest);
  }

  // Usado pelo /ready
  isHealthy(): boolean {
    return this.channel !== null;
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    if (this.channel) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  // Fica tentando com backoff ate conseguir. O broker costuma demorar mais
  // pra ficar pronto do que o servico, entao desistir na primeira falha
  // obrigaria a reiniciar o container na mao.
  private async doConnect(): Promise<void> {
    while (!this.closed && !this.channel) {
      try {
        this.connection = await amqp.connect(this.options.url, {
          clientProperties: { connection_name: this.options.serviceName },
        });

        this.connection.on('error', (err: Error) => {
          this.warn('Erro na conexão:', err.message);
        });
        this.connection.on('close', () => {
          if (this.closed) return;
          this.warn('Conexão encerrada pelo broker. Reconectando...');
          this.channel = null;
          this.connection = null;
          void this.connect();
        });

        this.channel = await this.connection.createConfirmChannel();
        await this.channel.prefetch(this.options.prefetch);
        await this.assertTopology(this.channel);

        this.reconnectAttempts = 0;
        this.log('Conectado e topologia declarada.');

        // Depois de cair e voltar, os consumidores precisam ser religados
        for (const sub of this.subscriptions) {
          await this.startConsumer(sub);
        }
      } catch (err) {
        this.channel = null;
        this.connection = null;
        this.reconnectAttempts += 1;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
        this.warn(
          `Falha ao conectar (tentativa ${this.reconnectAttempts}): ${(err as Error).message}. ` +
            `Nova tentativa em ${delay}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Declarar de novo o que ja existe nao da erro no AMQP, entao os dois
  // servicos rodam isso no boot e tanto faz qual subir primeiro.
  private async assertTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(EXCHANGES.EVENTS, 'topic', { durable: true });
    await channel.assertExchange(EXCHANGES.RETRY, 'topic', { durable: true });
    await channel.assertExchange(EXCHANGES.DLX, 'topic', { durable: true });

    await channel.assertQueue(QUEUES.DEAD_LETTER, { durable: true });
    await channel.bindQueue(QUEUES.DEAD_LETTER, EXCHANGES.DLX, '#');

    await channel.assertQueue(QUEUES.PAYMENTS_ORDER_CREATED, { durable: true });
    await channel.bindQueue(
      QUEUES.PAYMENTS_ORDER_CREATED,
      EXCHANGES.EVENTS,
      ROUTING_KEYS.ORDER_CREATED
    );

    // Truque do retry: a mensagem fica parada aqui ate o TTL estourar, e aí
    // o proprio RabbitMQ dead-letter ela de volta pra fila de pagamentos.
    // Sai de graca um retry com atraso, sem precisar de setTimeout no codigo.
    await channel.assertQueue(QUEUES.PAYMENTS_ORDER_CREATED_RETRY, {
      durable: true,
      messageTtl: this.options.retryDelayMs,
      deadLetterExchange: EXCHANGES.EVENTS,
      deadLetterRoutingKey: ROUTING_KEYS.ORDER_CREATED,
    });
    await channel.bindQueue(
      QUEUES.PAYMENTS_ORDER_CREATED_RETRY,
      EXCHANGES.RETRY,
      ROUTING_KEYS.ORDER_CREATED
    );

    await channel.assertQueue(QUEUES.ORDERS_PAYMENT_PROCESSED, { durable: true });
    await channel.bindQueue(
      QUEUES.ORDERS_PAYMENT_PROCESSED,
      EXCHANGES.EVENTS,
      ROUTING_KEYS.PAYMENT_ALL
    );
  }

  // Publica e so resolve quando o broker confirma que aceitou
  async publish(routingKey: string, payload: unknown): Promise<void> {
    const channel = this.requireChannel();
    const content = Buffer.from(JSON.stringify(payload));

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGES.EVENTS,
        routingKey,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          messageId: randomUUID(),
          timestamp: Date.now(),
          appId: this.options.serviceName,
        },
        (err) => (err ? reject(err) : resolve())
      );
    });

    this.log(`Evento publicado: ${routingKey}`);
  }

  // Guardamos a inscricao em memoria para religar depois de uma reconexao
  async subscribe(
    queue: string,
    routingKeys: string[],
    handler: EventHandler
  ): Promise<void> {
    const sub: Subscription = { queue, routingKeys, handler };
    this.subscriptions.push(sub);

    if (this.channel) {
      await this.startConsumer(sub);
    }
  }

  private async startConsumer(sub: Subscription): Promise<void> {
    const channel = this.requireChannel();

    await channel.consume(
      sub.queue,
      async (message) => {
        if (!message) return;

        const routingKey = message.fields.routingKey;

        // A fila pode estar ligada a mais chaves do que este handler trata,
        // como o payment.* que cobre approved e rejected
        if (!matchesAny(routingKey, sub.routingKeys)) {
          channel.ack(message);
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(message.content.toString());
        } catch {
          this.warn(`Mensagem inválida em ${sub.queue}, enviando para DLQ.`);
          await this.sendToDeadLetter(message, routingKey, 'payload nao e JSON valido');
          channel.ack(message);
          return;
        }

        try {
          await sub.handler(payload, routingKey, {
            retryCount: this.readRetryCount(message),
            messageId: message.properties.messageId,
          });
          channel.ack(message);
        } catch (err) {
          const reason = (err as Error).message;
          const attempt = this.readRetryCount(message) + 1;

          if (attempt <= this.options.maxRetries) {
            this.warn(
              `Falha ao processar ${routingKey} (tentativa ${attempt}/${this.options.maxRetries}): ${reason}. ` +
                `Reagendando em ${this.options.retryDelayMs}ms.`
            );
            await this.sendToRetry(message, routingKey, attempt);
          } else {
            this.warn(
              `Falha definitiva em ${routingKey} após ${this.options.maxRetries} retentativas: ${reason}. ` +
                `Enviando para ${QUEUES.DEAD_LETTER}.`
            );
            await this.sendToDeadLetter(message, routingKey, reason);
          }

          // A copia ja esta na fila de retry ou na DLQ, entao a original sai
          channel.ack(message);
        }
      },
      { noAck: false }
    );

    this.log(`Consumindo fila "${sub.queue}" (${sub.routingKeys.join(', ')}).`);
  }

  private readRetryCount(message: amqp.ConsumeMessage): number {
    const raw = message.properties.headers?.[RETRY_COUNT_HEADER];
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private async sendToRetry(
    message: amqp.ConsumeMessage,
    routingKey: string,
    attempt: number
  ): Promise<void> {
    const channel = this.requireChannel();

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGES.RETRY,
        routingKey,
        message.content,
        {
          persistent: true,
          contentType: message.properties.contentType ?? 'application/json',
          messageId: message.properties.messageId,
          headers: { ...message.properties.headers, [RETRY_COUNT_HEADER]: attempt },
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  private async sendToDeadLetter(
    message: amqp.ConsumeMessage,
    routingKey: string,
    reason: string
  ): Promise<void> {
    const channel = this.requireChannel();

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGES.DLX,
        routingKey,
        message.content,
        {
          persistent: true,
          contentType: message.properties.contentType ?? 'application/json',
          messageId: message.properties.messageId,
          headers: {
            ...message.properties.headers,
            [ERROR_HEADER]: reason,
            'x-failed-service': this.options.serviceName,
            'x-failed-at': new Date().toISOString(),
          },
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  // Falha na hora em vez de tentar reconectar aqui. Um publish no meio do
  // checkout nao pode ficar pendurado esperando o broker voltar, e a
  // reconexao ja esta rodando em background de qualquer jeito.
  private requireChannel(): ConfirmChannel {
    if (!this.channel) {
      throw new Error('Canal AMQP indisponível: broker desconectado');
    }
    return this.channel;
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.channel?.close();
    } catch {
      // ja estava fechado
    }
    try {
      await this.connection?.close();
    } catch {
      // ja estava fechada
    }
    this.channel = null;
    this.connection = null;
  }
}

// Compara a routing key com os padroes do AMQP, onde * vale um segmento
function matchesAny(routingKey: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === routingKey) return true;
    if (!pattern.includes('*') && !pattern.includes('#')) return false;

    const source = pattern
      .split('.')
      .map((part) => {
        if (part === '*') return '[^.]+';
        if (part === '#') return '.*';
        return escapeRegExp(part);
      })
      .join('\\.');

    return new RegExp('^' + source + '$').test(routingKey);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

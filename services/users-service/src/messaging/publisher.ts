import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';

// Publicador de eventos do users-service. Só publica: não consome nada.
// Mesma ideia do broker dos outros serviços (conexão que reconecta sozinha com
// backoff, publish com confirmação do broker), sem a parte de consumo.

export const EVENTS_EXCHANGE = 'districommerce.events';

export const ROUTING_KEYS = {
  // O titular pediu a exclusão da conta (LGPD). Quem guarda dado dele apaga.
  USER_DELETED: 'user.deleted',
} as const;

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;

export class EventPublisher {
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private attempts = 0;

  constructor(
    private readonly url: string,
    private readonly serviceName = 'users-service'
  ) {}

  isHealthy(): boolean {
    return this.channel !== null;
  }

  async connect(): Promise<void> {
    if (this.closed || this.channel) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  // Fica tentando com backoff até conseguir: o broker costuma demorar mais para
  // ficar pronto do que o serviço.
  private async doConnect(): Promise<void> {
    while (!this.closed && !this.channel) {
      try {
        this.connection = await amqp.connect(this.url, {
          clientProperties: { connection_name: this.serviceName },
        });

        this.connection.on('error', (err: Error) => {
          console.warn(`[${this.serviceName}][rabbitmq] Erro na conexão: ${err.message}`);
        });
        this.connection.on('close', () => {
          if (this.closed) return;
          console.warn(`[${this.serviceName}][rabbitmq] Conexão encerrada pelo broker. Reconectando...`);
          this.channel = null;
          this.connection = null;
          void this.connect();
        });

        this.channel = await this.connection.createConfirmChannel();
        // Mesmos argumentos dos outros serviços: redeclarar não dá erro
        await this.channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });

        this.attempts = 0;
        console.log(`[${this.serviceName}][rabbitmq] Conectado.`);
      } catch (err) {
        this.channel = null;
        this.connection = null;
        this.attempts += 1;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts, 5));
        console.warn(
          `[${this.serviceName}][rabbitmq] Falha ao conectar (tentativa ${this.attempts}): ` +
            `${(err as Error).message}. Nova tentativa em ${delay}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Só resolve quando o broker confirma que aceitou a mensagem. Sem conexão,
  // falha na hora: quem chama decide o que fazer (a exclusão de conta devolve 503).
  async publish(routingKey: string, payload: Record<string, unknown>): Promise<void> {
    const channel = this.channel;
    if (!channel) {
      throw new Error('Canal AMQP indisponível: broker desconectado');
    }

    const content = Buffer.from(JSON.stringify(payload));
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EVENTS_EXCHANGE,
        routingKey,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          messageId: randomUUID(),
          timestamp: Date.now(),
          appId: this.serviceName,
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.channel?.close();
    } catch {
      // já estava fechado
    }
    try {
      await this.connection?.close();
    } catch {
      // já estava fechada
    }
    this.channel = null;
    this.connection = null;
  }
}

export const publisher = new EventPublisher(env.RABBITMQ_URL);

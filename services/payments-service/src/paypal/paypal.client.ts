import { env } from '../config/env';
import { createCircuitBreaker } from '../resilience/circuit-breaker';

// Cliente do "PayPal" (na verdade o paypal-mock, que imita a API REST v2).
// Toda chamada HTTP passa pelo circuit breaker "paypal-gateway".

// O PayPal respondeu com erro de negocio (4xx). O gateway esta saudavel,
// quem falhou foi a operacao: nao conta para o breaker e nao adianta repetir.
export class PayPalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorName: string,
    public readonly issue: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'PayPalApiError';
  }
}

// 5xx ou resposta ilegivel: o gateway esta com problema. Conta como falha.
export class PayPalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayPalUnavailableError';
  }
}

export const paypalBreaker = createCircuitBreaker({
  name: 'paypal-gateway',
  slidingWindowSize: env.CB_SLIDING_WINDOW_SIZE,
  minimumNumberOfCalls: env.CB_MINIMUM_CALLS,
  failureRateThreshold: env.CB_FAILURE_RATE_THRESHOLD,
  resetTimeoutMs: env.CB_RESET_TIMEOUT_MS,
  halfOpenMaxCalls: env.CB_HALF_OPEN_MAX_CALLS,
  callTimeoutMs: env.CB_CALL_TIMEOUT_MS,
  isFailure: (err) => !(err instanceof PayPalApiError),
});

export interface PayPalOrder {
  id: string;
  status: 'CREATED' | 'PAYER_ACTION_REQUIRED' | 'APPROVED' | 'COMPLETED';
  purchase_units: Array<{
    reference_id: string;
    amount: { currency_code: string; value: string };
    payments?: { captures?: Array<{ id: string; status: string }> };
  }>;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  requestId?: string;
}

export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;

  // Passo 1: client credentials. O token e reaproveitado ate perto de vencer.
  private async accessToken(signal: AbortSignal, forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }

    const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal,
    });

    const data = await this.parse(res);
    this.token = {
      value: data.access_token as string,
      expiresAt: Date.now() + Number(data.expires_in) * 1000,
    };
    return this.token.value;
  }

  private async parse(res: Response): Promise<Record<string, any>> {
    let data: Record<string, any> = {};
    try {
      data = (await res.json()) as Record<string, any>;
    } catch {
      // corpo vazio ou nao-JSON
    }

    if (res.status >= 500) {
      throw new PayPalUnavailableError(
        `PayPal respondeu HTTP ${res.status}${data.name ? ` (${data.name})` : ''}`
      );
    }
    if (!res.ok) {
      const issue = data.details?.[0]?.issue as string | undefined;
      throw new PayPalApiError(
        res.status,
        (data.name as string) ?? 'UNKNOWN_ERROR',
        issue,
        `PayPal recusou a operação: ${issue ?? data.name ?? `HTTP ${res.status}`}`
      );
    }
    return data;
  }

  private request<T>(opts: RequestOptions): Promise<T> {
    return paypalBreaker.exec(async (signal) => {
      const send = async (token: string) =>
        fetch(`${env.PAYPAL_BASE_URL}${opts.path}`, {
          method: opts.method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            ...(opts.requestId ? { 'PayPal-Request-Id': opts.requestId } : {}),
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal,
        });

      let res = await send(await this.accessToken(signal));

      // Token expirado/invalidado (ex.: mock reiniciou): renova uma vez
      if (res.status === 401) {
        res = await send(await this.accessToken(signal, true));
      }

      return (await this.parse(res)) as T;
    });
  }

  // Passo 2: cria a ordem. O PayPal-Request-Id derivado do pedido torna a
  // chamada idempotente: se o RabbitMQ reentregar o order.created, o PayPal
  // devolve a mesma ordem em vez de criar outra.
  createOrder(orderId: string, amount: number): Promise<PayPalOrder> {
    return this.request<PayPalOrder>({
      method: 'POST',
      path: '/v2/checkout/orders',
      requestId: `create-${orderId}`,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: orderId,
            description: `DistriCommerce - pedido ${orderId.slice(0, 8)}`,
            amount: { currency_code: env.PAYPAL_CURRENCY, value: amount.toFixed(2) },
          },
        ],
      },
    });
  }

  // Simula o comprador aprovando (ou tendo o cartao recusado) na tela do
  // PayPal. So existe no simulador.
  simulatePayerApproval(paypalOrderId: string, outcome: 'APPROVE' | 'DECLINE'): Promise<PayPalOrder> {
    return this.request<PayPalOrder>({
      method: 'POST',
      path: `/v2/checkout/orders/${paypalOrderId}/simulate-approval`,
      body: { outcome },
    });
  }

  // Passo 3: captura o valor aprovado
  captureOrder(paypalOrderId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>({
      method: 'POST',
      path: `/v2/checkout/orders/${paypalOrderId}/capture`,
      requestId: `capture-${paypalOrderId}`,
    });
  }
}

export const paypalClient = new PayPalClient();

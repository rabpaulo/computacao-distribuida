import { env } from '../config/env';
import { createCircuitBreaker } from '../resilience/circuit-breaker';

// Resposta de regra de negocio do products-service. Nao indica que o
// servico esta doente, entao nao conta como falha para o breaker.
export class StockConflictError extends Error {
  constructor(public readonly productId: string) {
    super(`Estoque insuficiente para o produto ${productId}`);
    this.name = 'StockConflictError';
  }
}

// 5xx: o products-service respondeu, mas quebrado. Conta como falha.
export class UpstreamError extends Error {
  constructor(public readonly status: number) {
    super(`products-service respondeu HTTP ${status}`);
    this.name = 'UpstreamError';
  }
}

export const productsBreaker = createCircuitBreaker({
  name: 'products-service',
  slidingWindowSize: env.CB_SLIDING_WINDOW_SIZE,
  minimumNumberOfCalls: env.CB_MINIMUM_CALLS,
  failureRateThreshold: env.CB_FAILURE_RATE_THRESHOLD,
  resetTimeoutMs: env.CB_RESET_TIMEOUT_MS,
  halfOpenMaxCalls: env.CB_HALF_OPEN_MAX_CALLS,
  callTimeoutMs: env.CB_CALL_TIMEOUT_MS,
  isFailure: (err) => !(err instanceof StockConflictError),
});

// Ajusta o estoque de um produto (delta negativo reserva, positivo devolve).
// Toda chamada passa pelo breaker: com o products-service fora, depois de
// algumas falhas a chamada para de esperar timeout e falha na hora.
export async function adjustStock(
  productId: string,
  delta: number,
  token: string
): Promise<{ ok: boolean; status: number }> {
  return productsBreaker.exec(async (signal) => {
    const res = await fetch(`${env.PRODUCTS_SERVICE_URL}/api/v1/products/${productId}/stock`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ delta }),
      signal,
    });

    if (res.status === 409) {
      throw new StockConflictError(productId);
    }
    if (res.status >= 500) {
      throw new UpstreamError(res.status);
    }

    return { ok: res.ok, status: res.status };
  });
}

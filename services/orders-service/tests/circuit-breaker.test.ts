import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CallTimeoutError,
  CircuitBreaker,
  CircuitOpenError,
} from '../src/resilience/circuit-breaker';

class BusinessError extends Error {}

function newBreaker() {
  return new CircuitBreaker({
    name: 'teste',
    slidingWindowSize: 4,
    minimumNumberOfCalls: 4,
    failureRateThreshold: 0.5,
    resetTimeoutMs: 1000,
    halfOpenMaxCalls: 2,
    callTimeoutMs: 50,
    isFailure: (err) => !(err instanceof BusinessError),
  });
}

const ok = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('caiu'));

async function failTimes(b: CircuitBreaker, n: number) {
  for (let i = 0; i < n; i++) await b.exec(fail).catch(() => undefined);
}

describe('Circuit Breaker', () => {
  afterEach(() => vi.useRealTimers());

  it('fica CLOSED enquanto a taxa de falha está abaixo do limite', async () => {
    const b = newBreaker();
    await b.exec(ok);
    await b.exec(ok);
    await b.exec(ok);
    await failTimes(b, 1);
    expect(b.getState()).toBe('CLOSED');
  });

  it('não avalia antes do mínimo de chamadas', async () => {
    const b = newBreaker();
    await failTimes(b, 3);
    expect(b.getState()).toBe('CLOSED');
  });

  it('abre ao atingir a taxa de falha e passa a rejeitar sem chamar', async () => {
    const b = newBreaker();
    await b.exec(ok);
    await b.exec(ok);
    await failTimes(b, 2);
    expect(b.getState()).toBe('OPEN');

    const fn = vi.fn(ok);
    await expect(b.exec(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
    expect(b.snapshot().rejectedCalls).toBe(1);
  });

  it('erro de negócio não conta como falha', async () => {
    const b = newBreaker();
    for (let i = 0; i < 6; i++) {
      await b.exec(() => Promise.reject(new BusinessError('sem estoque'))).catch(() => undefined);
    }
    expect(b.getState()).toBe('CLOSED');
  });

  it('timeout conta como falha', async () => {
    const b = newBreaker();
    const slow = () => new Promise((resolve) => setTimeout(resolve, 200));
    await expect(b.exec(slow)).rejects.toBeInstanceOf(CallTimeoutError);
    expect(b.snapshot().failedCalls).toBe(1);
  });

  it('vai para HALF_OPEN após o reset e fecha com chamadas de teste bem-sucedidas', async () => {
    vi.useFakeTimers();
    const b = newBreaker();
    await failTimes(b, 4);
    expect(b.getState()).toBe('OPEN');

    vi.advanceTimersByTime(1000);
    expect(b.getState()).toBe('HALF_OPEN');

    await b.exec(ok);
    expect(b.getState()).toBe('HALF_OPEN');
    await b.exec(ok);
    expect(b.getState()).toBe('CLOSED');
  });

  it('volta para OPEN se a chamada de teste falhar', async () => {
    vi.useFakeTimers();
    const b = newBreaker();
    await failTimes(b, 4);
    vi.advanceTimersByTime(1000);
    expect(b.getState()).toBe('HALF_OPEN');

    await failTimes(b, 1);
    expect(b.getState()).toBe('OPEN');
  });

  it('notifica mudanças de estado', async () => {
    const b = newBreaker();
    const transitions: string[] = [];
    b.onStateChange((from, to) => transitions.push(`${from}->${to}`));
    await failTimes(b, 4);
    expect(transitions).toEqual(['CLOSED->OPEN']);
  });
});

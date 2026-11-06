// Circuit Breaker no estilo do Resilience4J, sem dependencia externa.
// O arquivo e o mesmo no orders-service e no payments-service.
//
//   CLOSED ──(taxa de falha >= limite na janela)──> OPEN
//   OPEN ──(passou resetTimeoutMs)──> HALF_OPEN
//   HALF_OPEN ──(todas as chamadas de teste ok)──> CLOSED
//   HALF_OPEN ──(qualquer falha)──> OPEN
//
// Enquanto esta OPEN, a chamada nem sai: falha na hora com CircuitOpenError.
// E isso que impede um servico lento de prender threads/conexoes de quem o
// chama e espalhar a falha em cascata pelo sistema.

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  // Tamanho da janela deslizante (ultimas N chamadas)
  slidingWindowSize?: number;
  // So avalia a taxa depois de ter pelo menos isso de chamadas na janela
  minimumNumberOfCalls?: number;
  // Fracao de falhas (0..1) que abre o circuito
  failureRateThreshold?: number;
  // Quanto tempo fica OPEN antes de deixar passar chamadas de teste
  resetTimeoutMs?: number;
  // Quantas chamadas de teste no HALF_OPEN
  halfOpenMaxCalls?: number;
  // Tempo maximo de uma chamada. Estourou, conta como falha.
  callTimeoutMs?: number;
  // Erro de regra de negocio (estoque insuficiente, cartao recusado) nao
  // significa que o servico remoto esta doente. Retorne false para esses.
  isFailure?: (error: unknown) => boolean;
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  failureRate: number;
  bufferedCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  lastStateChange: string;
  // Quando sai do OPEN (so preenchido enquanto estiver OPEN)
  retryAt: string | null;
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly breaker: string,
    public readonly retryAfterMs: number
  ) {
    super(
      `Circuit breaker "${breaker}" aberto: chamada bloqueada ` +
        `(nova tentativa em ${Math.ceil(retryAfterMs / 1000)}s)`
    );
    this.name = 'CircuitOpenError';
  }
}

export class CallTimeoutError extends Error {
  constructor(breaker: string, timeoutMs: number) {
    super(`Chamada protegida por "${breaker}" excedeu ${timeoutMs}ms`);
    this.name = 'CallTimeoutError';
  }
}

type Listener = (from: CircuitState, to: CircuitState, breaker: CircuitBreaker) => void;

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  // true = falha. Janela circular com as ultimas chamadas.
  private window: boolean[] = [];
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private halfOpenSuccesses = 0;
  private rejectedCalls = 0;
  private lastStateChange = new Date();
  private readonly listeners: Listener[] = [];

  private readonly opts: Required<Omit<CircuitBreakerOptions, 'isFailure'>> &
    Pick<CircuitBreakerOptions, 'isFailure'>;

  constructor(options: CircuitBreakerOptions) {
    this.opts = {
      slidingWindowSize: 10,
      minimumNumberOfCalls: 5,
      failureRateThreshold: 0.5,
      resetTimeoutMs: 15000,
      halfOpenMaxCalls: 2,
      callTimeoutMs: 5000,
      ...options,
    };
  }

  get name(): string {
    return this.opts.name;
  }

  getState(): CircuitState {
    // A transicao OPEN -> HALF_OPEN e preguicosa: acontece quando alguem
    // olha o estado ou tenta chamar depois do timeout.
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.opts.resetTimeoutMs) {
      this.transition('HALF_OPEN');
    }
    return this.state;
  }

  onStateChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  async exec<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === 'OPEN') {
      this.rejectedCalls += 1;
      throw new CircuitOpenError(this.name, this.retryAfterMs());
    }

    if (state === 'HALF_OPEN') {
      if (this.halfOpenInFlight >= this.opts.halfOpenMaxCalls) {
        this.rejectedCalls += 1;
        throw new CircuitOpenError(this.name, this.opts.resetTimeoutMs);
      }
      this.halfOpenInFlight += 1;
    }

    try {
      const result = await this.withTimeout(fn);
      this.recordSuccess(state);
      return result;
    } catch (err) {
      const countsAsFailure = this.opts.isFailure ? this.opts.isFailure(err) : true;
      if (countsAsFailure) {
        this.recordFailure(state);
      } else {
        // Erro de negocio: o servico respondeu, entao para o breaker e sucesso
        this.recordSuccess(state);
      }
      throw err;
    } finally {
      if (state === 'HALF_OPEN') {
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      }
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    const state = this.getState();
    const failed = this.window.filter(Boolean).length;
    return {
      name: this.name,
      state,
      failureRate: this.window.length ? Number((failed / this.window.length).toFixed(2)) : 0,
      bufferedCalls: this.window.length,
      failedCalls: failed,
      rejectedCalls: this.rejectedCalls,
      lastStateChange: this.lastStateChange.toISOString(),
      retryAt: state === 'OPEN' ? new Date(this.openedAt + this.opts.resetTimeoutMs).toISOString() : null,
    };
  }

  // Usado em teste e no endpoint de administracao
  reset(): void {
    this.window = [];
    this.halfOpenInFlight = 0;
    this.halfOpenSuccesses = 0;
    this.rejectedCalls = 0;
    if (this.state !== 'CLOSED') this.transition('CLOSED');
  }

  private retryAfterMs(): number {
    return Math.max(0, this.openedAt + this.opts.resetTimeoutMs - Date.now());
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CallTimeoutError(this.name, this.opts.callTimeoutMs));
      }, this.opts.callTimeoutMs);
    });

    try {
      return await Promise.race([fn(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private recordSuccess(stateAtCall: CircuitState): void {
    if (stateAtCall === 'HALF_OPEN') {
      // Pode ja ter voltado pra OPEN por causa de outra chamada de teste
      if (this.state !== 'HALF_OPEN') return;
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.opts.halfOpenMaxCalls) {
        this.transition('CLOSED');
      }
      return;
    }
    this.push(false);
  }

  private recordFailure(stateAtCall: CircuitState): void {
    if (stateAtCall === 'HALF_OPEN') {
      if (this.state === 'HALF_OPEN') this.transition('OPEN');
      return;
    }

    this.push(true);

    if (this.state !== 'CLOSED') return;
    if (this.window.length < this.opts.minimumNumberOfCalls) return;

    const failed = this.window.filter(Boolean).length;
    if (failed / this.window.length >= this.opts.failureRateThreshold) {
      this.transition('OPEN');
    }
  }

  private push(failed: boolean): void {
    this.window.push(failed);
    if (this.window.length > this.opts.slidingWindowSize) {
      this.window.shift();
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;
    this.lastStateChange = new Date();

    if (to === 'OPEN') {
      this.openedAt = Date.now();
    }
    if (to === 'HALF_OPEN') {
      this.halfOpenInFlight = 0;
      this.halfOpenSuccesses = 0;
    }
    if (to === 'CLOSED') {
      // Janela limpa: o historico de antes da queda nao vale mais
      this.window = [];
    }

    for (const listener of this.listeners) {
      listener(from, to, this);
    }
  }
}

// Registro dos breakers do processo, exposto no /health e /circuit-breakers
const registry = new Map<string, CircuitBreaker>();

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const breaker = new CircuitBreaker(options);
  breaker.onStateChange((from, to, b) => {
    const level = to === 'OPEN' ? 'warn' : 'log';
    console[level](`[circuit-breaker] "${b.name}": ${from} -> ${to}`);
  });
  registry.set(breaker.name, breaker);
  return breaker;
}

export function listCircuitBreakers(): CircuitBreakerSnapshot[] {
  return [...registry.values()].map((b) => b.snapshot());
}

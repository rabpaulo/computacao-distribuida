import express, { Application, NextFunction, Request, Response } from 'express';
import morgan from 'morgan';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

// ============================================================================
// Simulador do PayPal (API REST v2 - Orders)
//
// NAO e uma integracao real e nao fala com o PayPal. Reproduz apenas o
// formato do fluxo de checkout em 3 passos, para o payments-service ter
// uma dependencia HTTP externa de verdade (que cai, demora e falha):
//
//   1. POST /v1/oauth2/token                    -> access token (client credentials)
//   2. POST /v2/checkout/orders                 -> ordem PAYER_ACTION_REQUIRED
//      (comprador "aprova" no PayPal - aqui simulado por
//       POST /v2/checkout/orders/:id/simulate-approval)
//   3. POST /v2/checkout/orders/:id/capture     -> COMPLETED ou INSTRUMENT_DECLINED
//
// O modo "caos" (POST /__admin/chaos) injeta latencia e erros 5xx para
// demonstrar o circuit breaker do payments-service.
// ============================================================================

export type ChaosMode = 'normal' | 'error' | 'slow';

export interface MockConfig {
  clientId: string;
  clientSecret: string;
  latencyMs: number;
  failureRate: number;
  mode: ChaosMode;
  // Latencia usada no modo "slow" (acima do timeout do cliente)
  slowLatencyMs: number;
}

type OrderStatus = 'CREATED' | 'PAYER_ACTION_REQUIRED' | 'APPROVED' | 'COMPLETED';

interface MockOrder {
  id: string;
  intent: 'CAPTURE';
  status: OrderStatus;
  referenceId: string;
  amount: { currency_code: string; value: string };
  createTime: string;
  updateTime: string;
  declineOnCapture: boolean;
  captureId?: string;
}

// IDs no mesmo formato visual do PayPal (17 caracteres alfanumericos)
function paypalId(length = 17): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i += 1) id += alphabet[bytes[i] % alphabet.length];
  return id;
}

// Corpo de erro no formato do PayPal
function paypalError(
  res: Response,
  status: number,
  name: string,
  message: string,
  issue?: string
): void {
  res.status(status).json({
    name,
    message,
    debug_id: randomBytes(6).toString('hex'),
    ...(issue ? { details: [{ issue, description: message }] } : {}),
  });
}

const createOrderSchema = z.object({
  intent: z.literal('CAPTURE'),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().min(1),
        description: z.string().optional(),
        amount: z.object({
          currency_code: z.string().length(3),
          value: z.string().regex(/^\d+(\.\d{1,2})?$/),
        }),
      })
    )
    .length(1),
});

export function createApp(initial: MockConfig): Application {
  const config: MockConfig = { ...initial };
  const tokens = new Map<string, number>(); // token -> expira em (epoch ms)
  const orders = new Map<string, MockOrder>();
  // PayPal-Request-Id -> resposta ja enviada (idempotencia de verdade do PayPal)
  const idempotency = new Map<string, { status: number; body: unknown }>();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------------------------------------------------------------- health
  app.get('/health', (_req, res) => {
    res.json({
      status: 'UP',
      service: 'paypal-mock',
      chaos: { mode: config.mode, failureRate: config.failureRate, latencyMs: config.latencyMs },
      orders: orders.size,
      timestamp: new Date().toISOString(),
    });
  });

  // ----------------------------------------------------------------- caos
  app.get('/__admin/chaos', (_req, res) => {
    res.json({ mode: config.mode, failureRate: config.failureRate, latencyMs: config.latencyMs });
  });

  app.post('/__admin/chaos', (req, res) => {
    const parsed = z
      .object({
        mode: z.enum(['normal', 'error', 'slow']).optional(),
        failureRate: z.number().min(0).max(1).optional(),
        latencyMs: z.number().int().nonnegative().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      paypalError(res, 400, 'INVALID_REQUEST', 'Configuração de caos inválida');
      return;
    }

    Object.assign(config, parsed.data);
    console.log(`[paypal-mock] Caos atualizado: ${JSON.stringify(parsed.data)}`);
    res.json({ mode: config.mode, failureRate: config.failureRate, latencyMs: config.latencyMs });
  });

  // Tudo da API "PayPal" passa pela injecao de falhas
  const chaos = async (_req: Request, res: Response, next: NextFunction) => {
    if (config.mode === 'slow') {
      await sleep(config.slowLatencyMs);
    } else if (config.latencyMs > 0) {
      await sleep(config.latencyMs);
    }

    if (config.mode === 'error' || Math.random() < config.failureRate) {
      paypalError(res, 503, 'SERVICE_UNAVAILABLE', 'Serviço temporariamente indisponível (simulado)');
      return;
    }
    next();
  };

  app.use('/v1', chaos);
  app.use('/v2', chaos);

  // --------------------------------------------------------------- OAuth2
  app.post('/v1/oauth2/token', (req, res) => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    const [id, secret] =
      scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];

    if (id !== config.clientId || secret !== config.clientSecret) {
      paypalError(res, 401, 'invalid_client', 'Client Authentication failed');
      return;
    }
    if (req.body?.grant_type !== 'client_credentials') {
      paypalError(res, 400, 'unsupported_grant_type', 'Grant type deve ser client_credentials');
      return;
    }

    const token = `A21AA${randomBytes(24).toString('base64url')}`;
    const expiresIn = 32400;
    tokens.set(token, Date.now() + expiresIn * 1000);

    res.json({
      scope: 'https://uri.paypal.com/services/payments/payment',
      access_token: token,
      token_type: 'Bearer',
      app_id: 'APP-DISTRICOMMERCE-SANDBOX',
      expires_in: expiresIn,
      nonce: `${new Date().toISOString()}${randomUUID()}`,
    });
  });

  // Bearer obrigatorio na v2
  app.use('/v2', (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const exp = tokens.get(token);

    if (!exp || exp < Date.now()) {
      paypalError(res, 401, 'AUTHENTICATION_FAILURE', 'Authentication failed due to invalid authentication credentials or a missing Authorization header.');
      return;
    }
    next();
  });

  // Respostas repetidas para o mesmo PayPal-Request-Id (POST idempotente)
  const idempotent =
    (handler: (req: Request) => { status: number; body: unknown }) =>
    (req: Request, res: Response) => {
      const key = req.header('PayPal-Request-Id');
      const scopedKey = key ? `${req.method} ${req.path} ${key}` : null;

      if (scopedKey && idempotency.has(scopedKey)) {
        const cached = idempotency.get(scopedKey)!;
        res.status(cached.status).json(cached.body);
        return;
      }

      const result = handler(req);
      if (scopedKey && result.status < 500) idempotency.set(scopedKey, result);
      res.status(result.status).json(result.body);
    };

  const orderLinks = (order: MockOrder) => [
    { href: `/v2/checkout/orders/${order.id}`, rel: 'self', method: 'GET' },
    {
      href: `/checkoutnow?token=${order.id}`,
      rel: 'payer-action',
      method: 'GET',
    },
  ];

  const orderBody = (order: MockOrder) => ({
    id: order.id,
    intent: order.intent,
    status: order.status,
    purchase_units: [
      {
        reference_id: order.referenceId,
        amount: order.amount,
        ...(order.captureId
          ? {
              payments: {
                captures: [
                  {
                    id: order.captureId,
                    status: 'COMPLETED',
                    amount: order.amount,
                    final_capture: true,
                    create_time: order.updateTime,
                  },
                ],
              },
            }
          : {}),
      },
    ],
    ...(order.status === 'APPROVED' || order.status === 'COMPLETED'
      ? {
          payer: {
            name: { given_name: 'Comprador', surname: 'Sandbox' },
            email_address: 'comprador@sandbox.districommerce.test',
            payer_id: 'SANDBOXPAYER01',
          },
        }
      : {}),
    create_time: order.createTime,
    update_time: order.updateTime,
    links: orderLinks(order),
  });

  // ---------------------------------------------------------- Orders API
  app.post(
    '/v2/checkout/orders',
    idempotent((req) => {
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            name: 'INVALID_REQUEST',
            message: 'Request is not well-formed, syntactically incorrect, or violates schema.',
            details: parsed.error.issues.map((i) => ({
              field: i.path.join('/'),
              issue: 'INVALID_PARAMETER_VALUE',
              description: i.message,
            })),
          },
        };
      }

      const unit = parsed.data.purchase_units[0];
      const now = new Date().toISOString();
      const order: MockOrder = {
        id: paypalId(),
        intent: 'CAPTURE',
        status: 'PAYER_ACTION_REQUIRED',
        referenceId: unit.reference_id,
        amount: unit.amount,
        createTime: now,
        updateTime: now,
        declineOnCapture: false,
      };
      orders.set(order.id, order);
      console.log(
        `[paypal-mock] Ordem ${order.id} criada (${unit.amount.currency_code} ${unit.amount.value}, ref ${unit.reference_id})`
      );

      return { status: 201, body: orderBody(order) };
    })
  );

  app.get('/v2/checkout/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) {
      paypalError(res, 404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID');
      return;
    }
    res.json(orderBody(order));
  });

  // Substitui a tela de aprovacao do PayPal. No PayPal real quem faz isso e
  // o navegador do comprador, na pagina de checkout deles.
  app.post('/v2/checkout/orders/:id/simulate-approval', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) {
      paypalError(res, 404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID');
      return;
    }
    if (order.status === 'COMPLETED') {
      paypalError(res, 422, 'UNPROCESSABLE_ENTITY', 'Order already captured.', 'ORDER_ALREADY_CAPTURED');
      return;
    }

    const outcome = req.body?.outcome === 'DECLINE' ? 'DECLINE' : 'APPROVE';
    order.status = 'APPROVED';
    order.declineOnCapture = outcome === 'DECLINE';
    order.updateTime = new Date().toISOString();
    console.log(`[paypal-mock] Ordem ${order.id} aprovada pelo comprador (simulação: ${outcome})`);

    res.json(orderBody(order));
  });

  app.post(
    '/v2/checkout/orders/:id/capture',
    idempotent((req) => {
      const order = orders.get(req.params.id);
      if (!order) {
        return {
          status: 404,
          body: {
            name: 'RESOURCE_NOT_FOUND',
            message: 'The specified resource does not exist.',
            details: [{ issue: 'INVALID_RESOURCE_ID' }],
          },
        };
      }

      const unprocessable = (issue: string, description: string) => ({
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          message: 'The requested action could not be performed, semantically incorrect, or failed business validation.',
          details: [{ issue, description }],
        },
      });

      if (order.status === 'COMPLETED') {
        return unprocessable('ORDER_ALREADY_CAPTURED', 'Order already captured.');
      }
      if (order.status !== 'APPROVED') {
        return unprocessable('ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.');
      }
      if (order.declineOnCapture) {
        console.log(`[paypal-mock] Captura da ordem ${order.id} recusada (INSTRUMENT_DECLINED)`);
        return unprocessable('INSTRUMENT_DECLINED', 'The instrument presented was either declined by the processor or bank.');
      }

      order.status = 'COMPLETED';
      order.captureId = paypalId();
      order.updateTime = new Date().toISOString();
      console.log(`[paypal-mock] Ordem ${order.id} capturada (captura ${order.captureId})`);

      return { status: 201, body: orderBody(order) };
    })
  );

  app.use((_req, res) => {
    paypalError(res, 404, 'NOT_FOUND', 'Rota não existe no simulador PayPal');
  });

  return app;
}

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const CLIENT = 'client';
const SECRET = 'secret';

function newApp() {
  return createApp({
    clientId: CLIENT,
    clientSecret: SECRET,
    latencyMs: 0,
    failureRate: 0,
    mode: 'normal',
    slowLatencyMs: 50,
  });
}

async function token(app: ReturnType<typeof newApp>): Promise<string> {
  const res = await request(app)
    .post('/v1/oauth2/token')
    .auth(CLIENT, SECRET)
    .type('form')
    .send({ grant_type: 'client_credentials' });
  return res.body.access_token;
}

const orderBody = {
  intent: 'CAPTURE',
  purchase_units: [{ reference_id: 'pedido-1', amount: { currency_code: 'BRL', value: '150.00' } }],
};

describe('PayPal Mock - fluxo de checkout simulado', () => {
  let app: ReturnType<typeof newApp>;
  let bearer: string;

  beforeEach(async () => {
    app = newApp();
    bearer = `Bearer ${await token(app)}`;
  });

  it('recusa credenciais inválidas no OAuth', async () => {
    const res = await request(app)
      .post('/v1/oauth2/token')
      .auth(CLIENT, 'errado')
      .type('form')
      .send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(401);
  });

  it('exige bearer token na API v2', async () => {
    const res = await request(app).post('/v2/checkout/orders').send(orderBody);
    expect(res.status).toBe(401);
  });

  it('cria, aprova e captura uma ordem', async () => {
    const created = await request(app)
      .post('/v2/checkout/orders')
      .set('Authorization', bearer)
      .send(orderBody);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PAYER_ACTION_REQUIRED');

    const id = created.body.id;

    const beforeApproval = await request(app)
      .post(`/v2/checkout/orders/${id}/capture`)
      .set('Authorization', bearer);
    expect(beforeApproval.status).toBe(422);
    expect(beforeApproval.body.details[0].issue).toBe('ORDER_NOT_APPROVED');

    await request(app)
      .post(`/v2/checkout/orders/${id}/simulate-approval`)
      .set('Authorization', bearer)
      .send({ outcome: 'APPROVE' });

    const captured = await request(app)
      .post(`/v2/checkout/orders/${id}/capture`)
      .set('Authorization', bearer);
    expect(captured.status).toBe(201);
    expect(captured.body.status).toBe('COMPLETED');
    expect(captured.body.purchase_units[0].payments.captures[0].id).toHaveLength(17);
  });

  it('devolve INSTRUMENT_DECLINED quando o comprador simula recusa', async () => {
    const created = await request(app)
      .post('/v2/checkout/orders')
      .set('Authorization', bearer)
      .send(orderBody);
    const id = created.body.id;

    await request(app)
      .post(`/v2/checkout/orders/${id}/simulate-approval`)
      .set('Authorization', bearer)
      .send({ outcome: 'DECLINE' });

    const res = await request(app)
      .post(`/v2/checkout/orders/${id}/capture`)
      .set('Authorization', bearer);
    expect(res.status).toBe(422);
    expect(res.body.details[0].issue).toBe('INSTRUMENT_DECLINED');
  });

  it('é idempotente pelo header PayPal-Request-Id', async () => {
    const send = () =>
      request(app)
        .post('/v2/checkout/orders')
        .set('Authorization', bearer)
        .set('PayPal-Request-Id', 'create-pedido-1')
        .send(orderBody);

    const first = await send();
    const second = await send();
    expect(second.body.id).toBe(first.body.id);
  });

  it('modo caos "error" responde 503', async () => {
    await request(app).post('/__admin/chaos').send({ mode: 'error' });
    const res = await request(app)
      .post('/v2/checkout/orders')
      .set('Authorization', bearer)
      .send(orderBody);
    expect(res.status).toBe(503);
  });
});

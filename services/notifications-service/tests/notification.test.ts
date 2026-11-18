import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import type { Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { pool } from '../src/config/database';
import { env } from '../src/config/env';
import { createApp } from '../src/app';
import { hub } from '../src/container';
import { RealtimeHub } from '../src/services/realtime.hub';
import { NotificationService } from '../src/services/notification.service';
import { handleEvent } from '../src/messaging/consumers';

vi.mock('../src/config/database', () => ({
  pool: { query: vi.fn(), end: vi.fn() },
  initDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/messaging', () => ({
  broker: {
    isHealthy: vi.fn().mockReturnValue(true),
    publish: vi.fn(),
    subscribe: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  },
}));

const query = vi.mocked(pool.query);

const USER_ID = 'user-123';
const OTHER_USER_ID = 'user-456';
const ORDER_ID = '6f1b2f3e-9c4a-4f8d-9b7e-1a2b3c4d5e6f';
const EVENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NOTIFICATION_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';

function tokenFor(userId = USER_ID): string {
  return jwt.sign({ userId, email: 'a@b.com', role: 'ROLE_CUSTOMER' }, env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

function envelope(eventType: string) {
  return { eventId: EVENT_ID, eventType, occurredAt: new Date().toISOString() };
}

function fakeRes() {
  return {
    write: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
    destroyed: false,
  } as unknown as Response & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    user_id: USER_ID,
    event_id: EVENT_ID,
    type: 'ORDER_CREATED',
    level: 'info',
    title: 'Pedido recebido',
    message: 'Recebemos o pedido',
    order_id: ORDER_ID,
    read_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RealtimeHub', () => {
  it('entrega a notificação só às conexões do usuário certo', () => {
    const h = new RealtimeHub();
    const mine = fakeRes();
    const theirs = fakeRes();
    h.add(USER_ID, mine);
    h.add(OTHER_USER_ID, theirs);

    const delivered = h.publish(USER_ID, { id: 'n1' });

    expect(delivered).toBe(1);
    expect(mine.write).toHaveBeenCalledWith(expect.stringContaining('event: notification'));
    expect(mine.write).toHaveBeenCalledWith(expect.stringContaining('"id":"n1"'));
    expect(theirs.write).not.toHaveBeenCalled();
  });

  it('não escreve nada quando o usuário não tem conexão aberta', () => {
    expect(new RealtimeHub().publish(USER_ID, { id: 'n1' })).toBe(0);
  });

  it('encerra a conexão mais antiga quando passa do limite por usuário', () => {
    const h = new RealtimeHub(2);
    const first = fakeRes();
    const second = fakeRes();
    const third = fakeRes();
    h.add(USER_ID, first);
    h.add(USER_ID, second);
    h.add(USER_ID, third);

    expect(first.end).toHaveBeenCalled();
    expect(second.end).not.toHaveBeenCalled();
    expect(h.connectionCount(USER_ID)).toBe(2);
  });

  it('remove a conexão quando o cliente desconecta', () => {
    const h = new RealtimeHub();
    const res = fakeRes();
    const remove = h.add(USER_ID, res);
    expect(h.connectionCount()).toBe(1);

    remove();

    expect(h.connectionCount()).toBe(0);
    expect(h.publish(USER_ID, { id: 'n1' })).toBe(0);
  });

  it('heartbeat escreve um comentário SSE em cada conexão', () => {
    const h = new RealtimeHub();
    const res = fakeRes();
    h.add(USER_ID, res);

    h.heartbeat();

    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('ignora conexões já encerradas', () => {
    const h = new RealtimeHub();
    const res = fakeRes();
    (res as unknown as { writableEnded: boolean }).writableEnded = true;
    h.add(USER_ID, res);

    expect(h.publish(USER_ID, { id: 'n1' })).toBe(0);
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('handleEvent (eventos do broker -> notificações)', () => {
  function fakeService() {
    return {
      rememberOrderOwner: vi.fn().mockResolvedValue(undefined),
      findOrderOwner: vi.fn(),
      create: vi.fn().mockResolvedValue(null),
      deleteUserData: vi.fn().mockResolvedValue({ notifications: 2, orders: 1 }),
    } as unknown as NotificationService & Record<string, ReturnType<typeof vi.fn>>;
  }

  it('order.created guarda o dono do pedido e avisa o cliente', async () => {
    const service = fakeService();

    await handleEvent(
      service,
      { ...envelope('order.created'), orderId: ORDER_ID, userId: USER_ID, totalAmount: 199.9 },
      'order.created'
    );

    expect(service.rememberOrderOwner).toHaveBeenCalledWith(ORDER_ID, USER_ID);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        userId: USER_ID,
        orderId: ORDER_ID,
        type: 'ORDER_CREATED',
        level: 'info',
      })
    );
    const created = (service.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(created.message).toContain('#6F1B2F3E');
  });

  it('payment.approved descobre o usuário pelo dono do pedido', async () => {
    const service = fakeService();
    (service.findOrderOwner as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);

    await handleEvent(
      service,
      {
        ...envelope('payment.approved'),
        orderId: ORDER_ID,
        paymentId: NOTIFICATION_ID,
        amount: 50,
      },
      'payment.approved'
    );

    expect(service.findOrderOwner).toHaveBeenCalledWith(ORDER_ID);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, type: 'PAYMENT_APPROVED', level: 'success' })
    );
  });

  it('payment.rejected inclui o motivo da recusa', async () => {
    const service = fakeService();
    (service.findOrderOwner as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);

    await handleEvent(
      service,
      {
        ...envelope('payment.rejected'),
        orderId: ORDER_ID,
        paymentId: NOTIFICATION_ID,
        amount: 50,
        reason: 'Saldo insuficiente',
      },
      'payment.rejected'
    );

    const created = (service.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(created.type).toBe('PAYMENT_REJECTED');
    expect(created.level).toBe('error');
    expect(created.message).toContain('Saldo insuficiente');
  });

  it('lança erro quando ainda não sabe de quem é o pedido (o broker tenta de novo)', async () => {
    const service = fakeService();
    (service.findOrderOwner as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      handleEvent(
        service,
        { ...envelope('payment.approved'), orderId: ORDER_ID, paymentId: NOTIFICATION_ID, amount: 1 },
        'payment.approved'
      )
    ).rejects.toThrow(/desconhecido/);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('order.confirmed avisa que o pedido foi confirmado', async () => {
    const service = fakeService();

    await handleEvent(
      service,
      { ...envelope('order.confirmed'), orderId: ORDER_ID, userId: USER_ID, totalAmount: 10 },
      'order.confirmed'
    );

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ORDER_CONFIRMED', level: 'success', userId: USER_ID })
    );
  });

  it.each([
    ['shipment.assigned', 'SHIPMENT_ASSIGNED', 'info'],
    ['shipment.in_transit', 'SHIPMENT_IN_TRANSIT', 'info'],
    ['shipment.delivered', 'SHIPMENT_DELIVERED', 'success'],
  ])('%s vira a notificação %s', async (routingKey, type, level) => {
    const service = fakeService();

    await handleEvent(
      service,
      {
        ...envelope(routingKey),
        shipmentId: NOTIFICATION_ID,
        orderId: ORDER_ID,
        userId: USER_ID,
        truckId: 'truck-01',
      },
      routingKey
    );

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ type, level, userId: USER_ID, orderId: ORDER_ID })
    );
  });

  it('user.deleted apaga os dados do titular (LGPD)', async () => {
    const service = fakeService();

    await handleEvent(service, { ...envelope('user.deleted'), userId: USER_ID }, 'user.deleted');

    expect(service.deleteUserData).toHaveBeenCalledWith(USER_ID);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejeita payload inválido para o broker reagendar e, no fim, mandar para a DLQ', async () => {
    const service = fakeService();

    await expect(
      handleEvent(service, { ...envelope('order.created'), orderId: 'nao-e-uuid' }, 'order.created')
    ).rejects.toThrow(/payload inválido/);
  });

  it('ignora routing key desconhecida sem lançar erro', async () => {
    const service = fakeService();
    await expect(handleEvent(service, {}, 'algo.estranho')).resolves.toBeUndefined();
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('NotificationService', () => {
  it('grava a notificação e empurra para as abas abertas do usuário', async () => {
    const h = new RealtimeHub();
    const publish = vi.spyOn(h, 'publish');
    const service = new NotificationService(h);
    query.mockResolvedValueOnce({ rows: [row()], rowCount: 1 } as never);

    const dto = await service.create({
      eventId: EVENT_ID,
      userId: USER_ID,
      type: 'ORDER_CREATED',
      level: 'info',
      title: 'Pedido recebido',
      message: 'Recebemos o pedido',
      orderId: ORDER_ID,
    });

    expect(dto?.id).toBe(NOTIFICATION_ID);
    // user_id e event_id são internos e não saem na API
    expect(dto).not.toHaveProperty('user_id');
    expect(dto).not.toHaveProperty('event_id');
    expect(publish).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ id: NOTIFICATION_ID }));
    expect(String(query.mock.calls[0][0])).toContain('ON CONFLICT (event_id) DO NOTHING');
  });

  it('não duplica quando o broker reentrega o mesmo evento', async () => {
    const h = new RealtimeHub();
    const publish = vi.spyOn(h, 'publish');
    const service = new NotificationService(h);
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const dto = await service.create({
      eventId: EVENT_ID,
      userId: USER_ID,
      type: 'ORDER_CREATED',
      level: 'info',
      title: 't',
      message: 'm',
    });

    expect(dto).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('só marca como lida a notificação do próprio usuário', async () => {
    const service = new NotificationService(new RealtimeHub());
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const updated = await service.markRead(OTHER_USER_ID, NOTIFICATION_ID);

    expect(updated).toBe(false);
    expect(query.mock.calls[0][0]).toContain('user_id = $2');
    expect(query.mock.calls[0][1]).toEqual([NOTIFICATION_ID, OTHER_USER_ID]);
  });

  it('deleteUserData remove notificações e vínculos de pedido do titular', async () => {
    const service = new NotificationService(new RealtimeHub());
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 3 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 2 } as never);

    const removed = await service.deleteUserData(USER_ID);

    expect(removed).toEqual({ notifications: 3, orders: 2 });
    expect(query.mock.calls[0][0]).toContain('DELETE FROM notifications');
    expect(query.mock.calls[1][0]).toContain('DELETE FROM order_owners');
  });
});

describe('API /api/v1/notifications', () => {
  const app = createApp();

  it('recusa acesso sem token', async () => {
    const response = await request(app).get('/api/v1/notifications');
    expect(response.status).toBe(401);
  });

  it('recusa token inválido', async () => {
    const response = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer token-invalido');
    expect(response.status).toBe(403);
  });

  it('lista as notificações do usuário com a contagem de não lidas', async () => {
    query
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ total: '4' }], rowCount: 1 } as never);

    const response = await request(app)
      .get('/api/v1/notifications?limit=10')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.unreadCount).toBe(4);
    // a consulta é sempre filtrada pelo usuário do token
    expect(query.mock.calls[0][1]).toEqual([USER_ID, 10]);
  });

  it('valida o limite da listagem', async () => {
    const response = await request(app)
      .get('/api/v1/notifications?limit=0')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(400);
  });

  it('valida o id ao marcar como lida', async () => {
    const response = await request(app)
      .post('/api/v1/notifications/abc/read')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(400);
  });

  it('devolve 404 ao marcar uma notificação que não é do usuário', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const response = await request(app)
      .post(`/api/v1/notifications/${NOTIFICATION_ID}/read`)
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(404);
  });

  it('marca todas como lidas', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 5 } as never);

    const response = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.updated).toBe(5);
  });

  it('expõe /health e /ready', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.service).toBe('notifications-service');

    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('READY');
  });
});

describe('Stream SSE (/api/v1/notifications/stream)', () => {
  const app = createApp();
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function openStream(token?: string): Promise<{
    res: http.IncomingMessage;
    req: http.ClientRequest;
    next: (match: string) => Promise<string>;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/api/v1/notifications/stream',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        (res) => {
          let buffer = '';
          const waiters: Array<{ match: string; done: (text: string) => void }> = [];
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            for (const w of [...waiters]) {
              if (buffer.includes(w.match)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.done(buffer);
              }
            }
          });

          const next = (match: string) =>
            new Promise<string>((done, fail) => {
              if (buffer.includes(match)) return done(buffer);
              const timer = setTimeout(() => fail(new Error(`timeout esperando "${match}"`)), 2000);
              waiters.push({
                match,
                done: (text) => {
                  clearTimeout(timer);
                  done(text);
                },
              });
            });

          resolve({ res, req, next });
        }
      );
      req.on('error', reject);
    });
  }

  it('recusa conexão sem token', async () => {
    const { res, req } = await openStream();
    expect(res.statusCode).toBe(401);
    req.destroy();
  });

  it('abre o stream, recebe o ready e depois as notificações do próprio usuário', async () => {
    const { res, req, next } = await openStream(tokenFor());

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.headers['x-accel-buffering']).toBe('no');

    await next('event: ready');
    expect(hub.connectionCount(USER_ID)).toBe(1);

    // notificação de OUTRO usuário não pode chegar nesta conexão
    hub.publish(OTHER_USER_ID, { id: 'de-outro' });
    hub.publish(USER_ID, { id: 'minha', title: 'Pedido a caminho' });

    const received = await next('"id":"minha"');
    expect(received).toContain('event: notification');
    expect(received).not.toContain('de-outro');

    req.destroy();
    // ao desconectar, o hub esquece a conexão
    await vi.waitFor(() => expect(hub.connectionCount(USER_ID)).toBe(0), { timeout: 2000 });
  });
});

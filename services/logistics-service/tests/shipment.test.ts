import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { pool } from '../src/config/database';
import { env } from '../src/config/env';
import { ShipmentService } from '../src/services/shipment.service';
import { FleetGateway } from '../src/iot/fleet.gateway';
import { createApp } from '../src/app';
import { truckIdFromTopic } from '../src/iot/topics';

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

const ORDER_ID = '6f1b2f3e-9c4a-4f8d-9b7e-1a2b3c4d5e6f';
const SHIPMENT_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';

function row(status: string, truckId: string | null = null) {
  return {
    id: SHIPMENT_ID,
    order_id: ORDER_ID,
    user_id: 'user-123',
    status,
    truck_id: truckId,
    origin_lat: -23.5614,
    origin_lng: -46.6559,
    dest_lat: -23.6,
    dest_lng: -46.6,
    current_lat: null,
    current_lng: null,
    progress: 0,
    speed_kmh: null,
    cargo_temp_c: null,
    eta_seconds: null,
    last_telemetry_at: null,
    delivered_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const event = {
  eventId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  eventType: 'order.confirmed' as const,
  occurredAt: new Date().toISOString(),
  orderId: ORDER_ID,
  userId: 'user-123',
  totalAmount: 100,
  items: [{ productId: 'p1', productName: 'Mouse', price: 100, quantity: 2 }],
};

function fakeFleet(online: string[]) {
  return {
    onlineTrucks: () => online.map((truckId) => ({ truckId, online: true })),
    dispatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as FleetGateway & { dispatch: ReturnType<typeof vi.fn> };
}

describe('Logistics Service - Entregas rastreadas por IoT', () => {
  const query = vi.mocked(pool.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extrai o truckId do tópico MQTT', () => {
    expect(truckIdFromTopic('districommerce/fleet/truck-01/telemetry')).toBe('truck-01');
    expect(truckIdFromTopic('outra/coisa/truck-01/telemetry')).toBeNull();
  });

  it('gera destino determinístico entre 3 e 12 km do CD', () => {
    const origin = { lat: -23.5614, lng: -46.6559 };
    const a = ShipmentService.destinationFor(ORDER_ID, origin);
    const b = ShipmentService.destinationFor(ORDER_ID, origin);
    expect(a).toEqual(b);
    const km = Math.hypot((a.lat - origin.lat) * 111.32, (a.lng - origin.lng) * 111.32 * Math.cos((origin.lat * Math.PI) / 180));
    expect(km).toBeGreaterThanOrEqual(2.9);
    expect(km).toBeLessThanOrEqual(12.1);
  });

  it('abre a entrega e despacha via MQTT para o caminhão menos ocupado', async () => {
    const fleet = fakeFleet(['truck-01', 'truck-02']);
    const service = new ShipmentService(fleet);

    query
      .mockResolvedValueOnce({ rows: [row('AWAITING_TRUCK')], rowCount: 1 } as never) // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never) // evento CREATED
      .mockResolvedValueOnce({ rows: [{ truck_id: 'truck-01', load: 2 }], rowCount: 1 } as never) // carga
      .mockResolvedValueOnce({ rows: [row('ASSIGNED', 'truck-02')], rowCount: 1 } as never) // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // evento ASSIGNED

    const shipment = await service.createFromOrder(event);

    expect(shipment.status).toBe('ASSIGNED');
    expect(query.mock.calls[3][1]).toEqual(['truck-02', SHIPMENT_ID]);
    expect(fleet.dispatch).toHaveBeenCalledWith(
      'truck-02',
      expect.objectContaining({ shipmentId: SHIPMENT_ID, orderId: ORDER_ID })
    );
  });

  it('deixa a entrega aguardando quando não há caminhão online', async () => {
    const fleet = fakeFleet([]);
    const service = new ShipmentService(fleet);

    query
      .mockResolvedValueOnce({ rows: [row('AWAITING_TRUCK')], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const shipment = await service.createFromOrder(event);

    expect(shipment.status).toBe('AWAITING_TRUCK');
    expect(fleet.dispatch).not.toHaveBeenCalled();
  });

  it('é idempotente quando o order.confirmed é reentregue', async () => {
    const fleet = fakeFleet(['truck-01']);
    const service = new ShipmentService(fleet);

    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // INSERT conflita
      .mockResolvedValueOnce({ rows: [row('IN_TRANSIT', 'truck-01')], rowCount: 1 } as never); // SELECT

    const shipment = await service.createFromOrder(event);

    expect(shipment.status).toBe('IN_TRANSIT');
    expect(fleet.dispatch).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('marca como entregue no evento DELIVERED do caminhão', async () => {
    const service = new ShipmentService(fakeFleet([]));
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await service.handleTruckEvent({
      truckId: 'truck-01',
      shipmentId: SHIPMENT_ID,
      type: 'DELIVERED',
      position: { lat: -23.6, lng: -46.6 },
      ts: new Date().toISOString(),
    });

    expect(query.mock.calls[0][0]).toContain("status = 'DELIVERED'");
    expect(query.mock.calls[1][1]).toContain('DELIVERED');
  });

  it('registra alerta quando a temperatura do baú passa do limite', async () => {
    const service = new ShipmentService(fakeFleet([]));
    query.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    const telemetry = {
      truckId: 'truck-01',
      shipmentId: SHIPMENT_ID,
      position: { lat: -23.58, lng: -46.63 },
      speedKmh: 40,
      cargoTempC: env.CARGO_TEMP_ALERT_C + 5,
      fuelPct: 80,
      progress: 0.5,
      etaSeconds: 30,
      ts: new Date().toISOString(),
    };

    await service.handleTelemetry(telemetry);
    await service.handleTelemetry(telemetry); // segundo alerta cai no cooldown

    const alerts = query.mock.calls.filter((c) => (c[1] as unknown[])?.[1] === 'TEMPERATURE_ALERT');
    expect(alerts).toHaveLength(1);
  });

  it('exige autenticação na API de rastreamento', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/shipments/my-shipments');
    expect(res.status).toBe(401);

    const token = jwt.sign({ userId: 'user-123', email: 'u@x.com', role: 'ROLE_CUSTOMER' }, env.JWT_SECRET);
    query.mockResolvedValueOnce({ rows: [row('ASSIGNED', 'truck-01')], rowCount: 1 } as never);
    const ok = await request(app).get('/api/v1/shipments/my-shipments').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.shipments[0].destination).toEqual({ lat: -23.6, lng: -46.6 });
  });
});

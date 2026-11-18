import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pool } from '../src/config/database';
import { broker } from '../src/messaging';
import { ShipmentService } from '../src/services/shipment.service';
import { FleetGateway } from '../src/iot/fleet.gateway';

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

const SHIPMENT_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';
const ORDER_ID = '6f1b2f3e-9c4a-4f8d-9b7e-1a2b3c4d5e6f';
const returned = { id: SHIPMENT_ID, order_id: ORDER_ID, user_id: 'user-123', truck_id: 'truck-01' };

function fakeFleet() {
  return {
    onlineTrucks: () => [],
    dispatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as FleetGateway;
}

// Publicamos eventos de entrega para o notifications-service avisar o cliente
describe('Logistics Service - eventos de status da entrega', () => {
  const query = vi.mocked(pool.query);
  const publish = vi.mocked(broker.publish);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publica shipment.in_transit quando o caminhão coleta a entrega', async () => {
    const service = new ShipmentService(fakeFleet());
    query
      .mockResolvedValueOnce({ rows: [returned], rowCount: 1 } as never) // UPDATE ... RETURNING
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // evento PICKED_UP

    await service.handleTruckEvent({
      truckId: 'truck-01',
      shipmentId: SHIPMENT_ID,
      type: 'PICKED_UP',
      position: { lat: -23.56, lng: -46.65 },
      ts: new Date().toISOString(),
    });

    expect(String(query.mock.calls[0][0])).toContain('RETURNING');
    expect(publish).toHaveBeenCalledTimes(1);
    const [routingKey, payload] = publish.mock.calls[0] as [string, Record<string, unknown>];
    expect(routingKey).toBe('shipment.in_transit');
    expect(payload).toMatchObject({
      eventType: 'shipment.in_transit',
      shipmentId: SHIPMENT_ID,
      orderId: ORDER_ID,
      userId: 'user-123',
      truckId: 'truck-01',
    });
    // eventId único: é por ele que o notifications-service não duplica a notificação
    expect(payload.eventId).toEqual(expect.any(String));
    expect(payload.occurredAt).toEqual(expect.any(String));
  });

  it('publica shipment.delivered quando a entrega é concluída', async () => {
    const service = new ShipmentService(fakeFleet());
    query
      .mockResolvedValueOnce({ rows: [returned], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await service.handleTruckEvent({
      truckId: 'truck-01',
      shipmentId: SHIPMENT_ID,
      type: 'DELIVERED',
      position: { lat: -23.6, lng: -46.6 },
      ts: new Date().toISOString(),
    });

    expect(publish).toHaveBeenCalledWith(
      'shipment.delivered',
      expect.objectContaining({ shipmentId: SHIPMENT_ID, userId: 'user-123' })
    );
  });

  it('não publica nada quando a entrega já estava no estado (reentrega MQTT)', async () => {
    const service = new ShipmentService(fakeFleet());
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await service.handleTruckEvent({
      truckId: 'truck-01',
      shipmentId: SHIPMENT_ID,
      type: 'DELIVERED',
      position: { lat: -23.6, lng: -46.6 },
      ts: new Date().toISOString(),
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('a entrega segue normalmente mesmo se o broker estiver fora do ar', async () => {
    const service = new ShipmentService(fakeFleet());
    publish.mockRejectedValueOnce(new Error('Canal AMQP indisponível: broker desconectado'));
    query
      .mockResolvedValueOnce({ rows: [returned], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await expect(
      service.handleTruckEvent({
        truckId: 'truck-01',
        shipmentId: SHIPMENT_ID,
        type: 'DELIVERED',
        position: { lat: -23.6, lng: -46.6 },
        ts: new Date().toISOString(),
      })
    ).resolves.toBeUndefined();
  });
});

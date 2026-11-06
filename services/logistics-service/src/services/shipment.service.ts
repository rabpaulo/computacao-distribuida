import { createHash, randomUUID } from 'node:crypto';
import { pool } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middlewares/error.middleware';
import { OrderConfirmedEvent } from '../messaging/events';
import { FleetGateway } from '../iot/fleet.gateway';
import {
  GeoPoint,
  TelemetryMessage,
  TruckEventMessage,
  TruckStatusMessage,
} from '../iot/topics';
import { Shipment, ShipmentEvent, ShipmentStatus } from '../models/shipment.model';

const COLUMNS = `id, order_id, user_id, status, truck_id, origin_lat, origin_lng, dest_lat, dest_lng,
  current_lat, current_lng, progress, speed_kmh, cargo_temp_c, eta_seconds, last_telemetry_at,
  delivered_at, created_at, updated_at`;

// Alerta de temperatura no maximo uma vez por minuto por entrega
const TEMP_ALERT_COOLDOWN_MS = 60_000;

export class ShipmentService {
  private readonly lastTempAlert = new Map<string, number>();

  constructor(private readonly fleet: FleetGateway) {}

  // O sistema nao guarda endereco do cliente, entao o destino e derivado do
  // id do pedido: um ponto fixo a 3-12 km do centro de distribuicao.
  static destinationFor(orderId: string, origin: GeoPoint): GeoPoint {
    const hash = createHash('sha256').update(orderId).digest();
    const angle = (hash.readUInt16BE(0) / 0xffff) * 2 * Math.PI;
    const distanceKm = 3 + (hash.readUInt16BE(2) / 0xffff) * 9;
    const dLat = (distanceKm / 111.32) * Math.cos(angle);
    const dLng = (distanceKm / (111.32 * Math.cos((origin.lat * Math.PI) / 180))) * Math.sin(angle);
    return {
      lat: Number((origin.lat + dLat).toFixed(6)),
      lng: Number((origin.lng + dLng).toFixed(6)),
    };
  }

  // --------------------------------------------------------------- RabbitMQ
  // Chega order.confirmed: abre a entrega e tenta despachar.
  async createFromOrder(event: OrderConfirmedEvent): Promise<Shipment> {
    const origin = { lat: env.WAREHOUSE_LAT, lng: env.WAREHOUSE_LNG };
    const destination = ShipmentService.destinationFor(event.orderId, origin);

    const inserted = await pool.query(
      `INSERT INTO shipments (id, order_id, user_id, status, origin_lat, origin_lng, dest_lat, dest_lng)
       VALUES ($1, $2, $3, 'AWAITING_TRUCK', $4, $5, $6, $7)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [randomUUID(), event.orderId, event.userId, origin.lat, origin.lng, destination.lat, destination.lng]
    );

    let shipment: Shipment;
    if (inserted.rowCount === 0) {
      // Reentrega do broker: ja existe
      const existing = await this.findByOrderId(event.orderId);
      if (!existing) throw new Error(`Falha ao abrir entrega do pedido ${event.orderId}`);
      shipment = existing;
    } else {
      shipment = this.mapRow(inserted.rows[0]);
      const items = event.items.reduce((acc, it) => acc + it.quantity, 0);
      await this.addEvent(shipment.id, 'CREATED', `Entrega aberta para ${items} item(ns)`);
      console.log(`[logistics-service] Entrega ${shipment.id} aberta para o pedido ${event.orderId}`);
    }

    if (shipment.status === 'AWAITING_TRUCK') {
      return (await this.assign(shipment)) ?? shipment;
    }
    return shipment;
  }

  // Escolhe o caminhao online com menos entregas em aberto
  private async pickTruck(): Promise<string | null> {
    const online = this.fleet.onlineTrucks();
    if (online.length === 0) return null;

    const res = await pool.query(
      `SELECT truck_id, COUNT(*)::int AS load FROM shipments
       WHERE status IN ('ASSIGNED', 'IN_TRANSIT') AND truck_id IS NOT NULL
       GROUP BY truck_id`
    );
    const load = new Map<string, number>(res.rows.map((r) => [r.truck_id, r.load]));

    return online
      .map((t) => t.truckId)
      .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0];
  }

  private async assign(shipment: Shipment): Promise<Shipment | null> {
    const truckId = await this.pickTruck();
    if (!truckId) {
      console.warn(`[logistics-service] Nenhum caminhão online. Entrega ${shipment.id} aguardando.`);
      return null;
    }

    // WHERE status = 'AWAITING_TRUCK': com duas replicas, so uma atribui
    const res = await pool.query(
      `UPDATE shipments SET status = 'ASSIGNED', truck_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'AWAITING_TRUCK'
       RETURNING ${COLUMNS}`,
      [truckId, shipment.id]
    );
    if (res.rowCount === 0) return null;

    const assigned = this.mapRow(res.rows[0]);
    await this.addEvent(assigned.id, 'ASSIGNED', `Despachada para o caminhão ${truckId}`);
    await this.sendDispatch(assigned);
    return assigned;
  }

  private async sendDispatch(shipment: Shipment): Promise<void> {
    if (!shipment.truck_id) return;
    await this.fleet.dispatch(shipment.truck_id, {
      shipmentId: shipment.id,
      orderId: shipment.order_id,
      origin: shipment.origin,
      destination: shipment.destination,
      ts: new Date().toISOString(),
    });
    console.log(`[logistics-service] Despacho MQTT: entrega ${shipment.id} -> ${shipment.truck_id}`);
  }

  // ------------------------------------------------------------------ MQTT
  async handleTruckStatus(msg: TruckStatusMessage): Promise<void> {
    if (!msg.online) return;

    // 1. Entregas que ficaram sem caminhao agora tem para quem ir
    const waiting = await pool.query(
      `SELECT ${COLUMNS} FROM shipments WHERE status = 'AWAITING_TRUCK' ORDER BY created_at`
    );
    for (const row of waiting.rows) {
      await this.assign(this.mapRow(row));
    }

    // 2. O caminhao reiniciou e perdeu entregas que eram dele: redespacha.
    // A rota recomeca do CD, entao a entrega volta para ASSIGNED.
    const mine = await pool.query(
      `SELECT ${COLUMNS} FROM shipments WHERE truck_id = $1 AND status IN ('ASSIGNED', 'IN_TRANSIT')`,
      [msg.truckId]
    );
    const known = new Set(msg.shipments ?? []);
    for (const row of mine.rows) {
      const shipment = this.mapRow(row);
      if (known.has(shipment.id)) continue;

      await pool.query(
        `UPDATE shipments SET status = 'ASSIGNED', progress = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status IN ('ASSIGNED', 'IN_TRANSIT')`,
        [shipment.id]
      );
      await this.addEvent(shipment.id, 'REDISPATCHED', `Caminhão ${msg.truckId} reiniciou, entrega reenviada`);
      await this.sendDispatch(shipment);
    }
  }

  async handleTelemetry(msg: TelemetryMessage): Promise<void> {
    if (!msg.shipmentId) return;

    await pool.query(
      `UPDATE shipments
       SET current_lat = $1, current_lng = $2, progress = $3, speed_kmh = $4,
           cargo_temp_c = $5, eta_seconds = $6, last_telemetry_at = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND status = 'IN_TRANSIT'`,
      [
        msg.position.lat,
        msg.position.lng,
        Math.min(1, Math.max(0, msg.progress)),
        msg.speedKmh,
        msg.cargoTempC,
        msg.etaSeconds,
        msg.ts,
        msg.shipmentId,
      ]
    );

    if (msg.cargoTempC > env.CARGO_TEMP_ALERT_C) {
      const last = this.lastTempAlert.get(msg.shipmentId) ?? 0;
      if (Date.now() - last > TEMP_ALERT_COOLDOWN_MS) {
        this.lastTempAlert.set(msg.shipmentId, Date.now());
        console.warn(
          `[logistics-service] ALERTA: baú do caminhão ${msg.truckId} a ${msg.cargoTempC.toFixed(1)}°C ` +
            `(entrega ${msg.shipmentId})`
        );
        await this.addEvent(
          msg.shipmentId,
          'TEMPERATURE_ALERT',
          `Temperatura do baú em ${msg.cargoTempC.toFixed(1)}°C (limite ${env.CARGO_TEMP_ALERT_C}°C)`,
          msg.position
        );
      }
    }
  }

  async handleTruckEvent(msg: TruckEventMessage): Promise<void> {
    if (msg.type === 'PICKED_UP') {
      const res = await pool.query(
        `UPDATE shipments SET status = 'IN_TRANSIT', current_lat = $1, current_lng = $2,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND status = 'ASSIGNED'`,
        [msg.position.lat, msg.position.lng, msg.shipmentId]
      );
      if (res.rowCount) {
        await this.addEvent(msg.shipmentId, 'PICKED_UP', `Coletada no CD pelo caminhão ${msg.truckId}`, msg.position);
      }
      return;
    }

    if (msg.type === 'DELIVERED') {
      const res = await pool.query(
        `UPDATE shipments SET status = 'DELIVERED', progress = 1, eta_seconds = 0,
           current_lat = $1, current_lng = $2, delivered_at = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND status <> 'DELIVERED'`,
        [msg.position.lat, msg.position.lng, msg.ts, msg.shipmentId]
      );
      if (res.rowCount) {
        this.lastTempAlert.delete(msg.shipmentId);
        await this.addEvent(msg.shipmentId, 'DELIVERED', `Entregue pelo caminhão ${msg.truckId}`, msg.position);
        console.log(`[logistics-service] Entrega ${msg.shipmentId} concluída`);
      }
    }
  }

  // ------------------------------------------------------------- Consultas
  private async addEvent(
    shipmentId: string,
    type: string,
    description: string,
    position?: GeoPoint
  ): Promise<void> {
    await pool.query(
      `INSERT INTO shipment_events (shipment_id, type, description, lat, lng) VALUES ($1, $2, $3, $4, $5)`,
      [shipmentId, type, description, position?.lat ?? null, position?.lng ?? null]
    );
  }

  async findByOrderId(orderId: string): Promise<Shipment | null> {
    const res = await pool.query(`SELECT ${COLUMNS} FROM shipments WHERE order_id = $1`, [orderId]);
    return res.rows.length ? this.mapRow(res.rows[0]) : null;
  }

  async getByOrderId(
    orderId: string,
    userId: string,
    role?: string
  ): Promise<Shipment & { events: ShipmentEvent[] }> {
    const shipment = await this.findByOrderId(orderId);
    if (!shipment) {
      throw new AppError(404, 'Entrega não encontrada para este pedido');
    }
    if (shipment.user_id !== userId && role !== 'ROLE_ADMIN') {
      throw new AppError(403, 'Acesso não autorizado a esta entrega');
    }

    const events = await pool.query(
      `SELECT id, type, description, lat, lng, created_at FROM shipment_events
       WHERE shipment_id = $1 ORDER BY created_at, id`,
      [shipment.id]
    );
    return { ...shipment, events: events.rows.map((e) => ({ ...e, id: Number(e.id) })) };
  }

  async listByUser(userId: string): Promise<Shipment[]> {
    const res = await pool.query(
      `SELECT ${COLUMNS} FROM shipments WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, any>): Shipment {
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      id: row.id,
      order_id: row.order_id,
      user_id: row.user_id,
      status: row.status as ShipmentStatus,
      truck_id: row.truck_id ?? null,
      origin: { lat: Number(row.origin_lat), lng: Number(row.origin_lng) },
      destination: { lat: Number(row.dest_lat), lng: Number(row.dest_lng) },
      current_position:
        row.current_lat === null || row.current_lat === undefined
          ? null
          : { lat: Number(row.current_lat), lng: Number(row.current_lng) },
      progress: Number(row.progress ?? 0),
      speed_kmh: num(row.speed_kmh),
      cargo_temp_c: num(row.cargo_temp_c),
      eta_seconds: num(row.eta_seconds),
      last_telemetry_at: row.last_telemetry_at ?? null,
      delivered_at: row.delivered_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

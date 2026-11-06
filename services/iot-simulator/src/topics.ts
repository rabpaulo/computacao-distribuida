// Contrato MQTT entre o logistics-service e os caminhoes (iot-simulator).
// Arquivo identico nos dois projetos.
//
//   districommerce/fleet/{truckId}/status     caminhao -> nuvem  QoS 1, retained (+ Last Will)
//   districommerce/fleet/{truckId}/telemetry  caminhao -> nuvem  QoS 0, a cada ~2s
//   districommerce/fleet/{truckId}/events     caminhao -> nuvem  QoS 1 (coleta, entrega)
//   districommerce/fleet/{truckId}/dispatch   nuvem -> caminhao  QoS 1 (nova entrega)
//
// Por que QoS diferentes: telemetria chega toda hora, perder uma leitura nao
// importa (QoS 0, "at most once", mais barato). Coleta/entrega e despacho
// mudam estado e nao podem se perder (QoS 1, "at least once" + idempotencia).

export const FLEET_ROOT = 'districommerce/fleet';

export const topics = {
  status: (truckId: string) => `${FLEET_ROOT}/${truckId}/status`,
  telemetry: (truckId: string) => `${FLEET_ROOT}/${truckId}/telemetry`,
  events: (truckId: string) => `${FLEET_ROOT}/${truckId}/events`,
  dispatch: (truckId: string) => `${FLEET_ROOT}/${truckId}/dispatch`,
};

// Curingas: + casa exatamente um nivel do topico
export const wildcards = {
  status: `${FLEET_ROOT}/+/status`,
  telemetry: `${FLEET_ROOT}/+/telemetry`,
  events: `${FLEET_ROOT}/+/events`,
};

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface TruckStatusMessage {
  truckId: string;
  online: boolean;
  // Entregas que o caminhao tem na fila (inclui a atual)
  shipments: string[];
  ts: string;
}

export interface TelemetryMessage {
  truckId: string;
  shipmentId: string | null;
  position: GeoPoint;
  speedKmh: number;
  // Sensor de temperatura do bau
  cargoTempC: number;
  fuelPct: number;
  // 0..1 na rota atual
  progress: number;
  etaSeconds: number | null;
  ts: string;
}

export type TruckEventType = 'PICKED_UP' | 'DELIVERED';

export interface TruckEventMessage {
  truckId: string;
  shipmentId: string;
  type: TruckEventType;
  position: GeoPoint;
  ts: string;
}

export interface DispatchMessage {
  shipmentId: string;
  orderId: string;
  origin: GeoPoint;
  destination: GeoPoint;
  ts: string;
}

// Extrai o truckId de districommerce/fleet/{truckId}/...
export function truckIdFromTopic(topic: string): string | null {
  const parts = topic.split('/');
  return parts.length === 4 && `${parts[0]}/${parts[1]}` === FLEET_ROOT ? parts[2] : null;
}

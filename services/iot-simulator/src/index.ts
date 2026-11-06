import { Truck } from './truck';

// Simulador da frota: cada caminhao e um "dispositivo" IoT independente,
// com conexao MQTT propria, sensores de GPS/temperatura/combustivel e uma
// fila de entregas recebidas do logistics-service.

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
};

const mqttUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const fleetSize = num('FLEET_SIZE', 3);

const trucks = Array.from({ length: fleetSize }, (_, i) =>
  new Truck({
    truckId: `truck-${String(i + 1).padStart(2, '0')}`,
    mqttUrl,
    warehouse: { lat: num('WAREHOUSE_LAT', -23.5614), lng: num('WAREHOUSE_LNG', -46.6559) },
    tripDurationMs: num('TRIP_DURATION_S', 60) * 1000,
    pickupDelayMs: num('PICKUP_DELAY_S', 5) * 1000,
    telemetryIntervalMs: num('TELEMETRY_INTERVAL_MS', 2000),
    tempSpikeProbability: num('TEMP_SPIKE_PROBABILITY', 0.03),
  })
);

console.log(`[iot-simulator] Iniciando frota com ${fleetSize} caminhões em ${mqttUrl}`);
trucks.forEach((t) => t.start());

const shutdown = async () => {
  console.log('[iot-simulator] Encerrando frota...');
  await Promise.allSettled(trucks.map((t) => t.stop()));
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

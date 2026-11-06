import mqtt, { MqttClient } from 'mqtt';
import {
  DispatchMessage,
  GeoPoint,
  TelemetryMessage,
  TruckEventMessage,
  TruckStatusMessage,
  topics,
} from './topics';
import { nextCargoTemp, positionAt } from './route';

export interface TruckConfig {
  truckId: string;
  mqttUrl: string;
  warehouse: GeoPoint;
  tripDurationMs: number;
  pickupDelayMs: number;
  telemetryIntervalMs: number;
  tempSpikeProbability: number;
}

interface Trip {
  dispatch: DispatchMessage;
  phase: 'LOADING' | 'DRIVING';
  phaseStartedAt: number;
}

// Um caminhao = um dispositivo IoT com sua propria conexao MQTT.
export class Truck {
  private client: MqttClient | null = null;
  private readonly queue: DispatchMessage[] = [];
  private trip: Trip | null = null;
  private position: GeoPoint;
  private cargoTempC = 22;
  private fuelPct = 100;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cfg: TruckConfig) {
    this.position = { ...cfg.warehouse };
  }

  private log(msg: string): void {
    console.log(`[iot-simulator][${this.cfg.truckId}] ${msg}`);
  }

  start(): void {
    const offline: TruckStatusMessage = {
      truckId: this.cfg.truckId,
      online: false,
      shipments: [],
      ts: new Date().toISOString(),
    };

    this.client = mqtt.connect(this.cfg.mqttUrl, {
      // clientId fixo + clean=false = sessao persistente. Se o caminhao cair,
      // o broker guarda os despachos QoS 1 e entrega quando ele voltar.
      clientId: this.cfg.truckId,
      clean: false,
      reconnectPeriod: 2000,
      // Last Will: se a conexao cair sem DISCONNECT (sinal perdido, bateria),
      // o proprio broker publica "offline" em nome do caminhao.
      will: {
        topic: topics.status(this.cfg.truckId),
        payload: Buffer.from(JSON.stringify(offline)),
        qos: 1,
        retain: true,
      },
    });

    this.client.on('connect', () => {
      this.log(`Conectado ao broker MQTT ${this.cfg.mqttUrl}`);
      this.client!.subscribe(topics.dispatch(this.cfg.truckId), { qos: 1 });
      this.publishStatus(true);
    });

    this.client.on('reconnect', () => this.log('Sem sinal, reconectando...'));
    this.client.on('error', (err) => this.log(`Erro MQTT: ${err.message}`));

    this.client.on('message', (_topic, payload) => {
      try {
        this.receiveDispatch(JSON.parse(payload.toString()) as DispatchMessage);
      } catch {
        this.log('Despacho inválido ignorado');
      }
    });

    this.timer = setInterval(() => this.tick(), this.cfg.telemetryIntervalMs);
  }

  private receiveDispatch(dispatch: DispatchMessage): void {
    // QoS 1 pode entregar repetido: ignora o que ja esta na fila
    const known =
      this.trip?.dispatch.shipmentId === dispatch.shipmentId ||
      this.queue.some((d) => d.shipmentId === dispatch.shipmentId);
    if (known) return;

    this.queue.push(dispatch);
    this.log(`Nova entrega recebida: ${dispatch.shipmentId} (fila: ${this.queue.length})`);
    this.publishStatus(true);
  }

  private shipmentIds(): string[] {
    return [
      ...(this.trip ? [this.trip.dispatch.shipmentId] : []),
      ...this.queue.map((d) => d.shipmentId),
    ];
  }

  private publishStatus(online: boolean): void {
    const msg: TruckStatusMessage = {
      truckId: this.cfg.truckId,
      online,
      shipments: this.shipmentIds(),
      ts: new Date().toISOString(),
    };
    this.client?.publish(topics.status(this.cfg.truckId), JSON.stringify(msg), {
      qos: 1,
      retain: true,
    });
  }

  private publishEvent(type: TruckEventMessage['type'], shipmentId: string): void {
    const msg: TruckEventMessage = {
      truckId: this.cfg.truckId,
      shipmentId,
      type,
      position: this.position,
      ts: new Date().toISOString(),
    };
    this.client?.publish(topics.events(this.cfg.truckId), JSON.stringify(msg), { qos: 1 });
    this.log(`${type} - entrega ${shipmentId}`);
  }

  private tick(): void {
    const now = Date.now();

    // Sem viagem: pega a proxima da fila e comeca a carregar no CD
    if (!this.trip && this.queue.length > 0) {
      const dispatch = this.queue.shift()!;
      // Entrega anterior terminou longe: volta pro CD (simplificado, instantaneo)
      this.position = { ...dispatch.origin };
      this.trip = { dispatch, phase: 'LOADING', phaseStartedAt: now };
    }

    let progress = 0;
    let speedKmh = 0;
    let etaSeconds: number | null = null;

    if (this.trip?.phase === 'LOADING' && now - this.trip.phaseStartedAt >= this.cfg.pickupDelayMs) {
      this.trip.phase = 'DRIVING';
      this.trip.phaseStartedAt = now;
      this.publishEvent('PICKED_UP', this.trip.dispatch.shipmentId);
    }

    if (this.trip?.phase === 'DRIVING') {
      const { origin, destination } = this.trip.dispatch;
      progress = Math.min(1, (now - this.trip.phaseStartedAt) / this.cfg.tripDurationMs);
      this.position = positionAt(origin, destination, progress);

      // A viagem da demo e acelerada (~1 min), entao a velocidade reportada
      // e a de transito urbano, nao a de verdade do ponto na tela
      speedKmh = progress < 1 ? Number((30 + Math.random() * 30).toFixed(1)) : 0;
      etaSeconds = Math.round(((1 - progress) * this.cfg.tripDurationMs) / 1000);
      this.fuelPct = Math.max(5, Number((this.fuelPct - 0.05).toFixed(2)));
    }

    this.cargoTempC = nextCargoTemp(this.cargoTempC, this.trip ? this.cfg.tempSpikeProbability : 0);

    const telemetry: TelemetryMessage = {
      truckId: this.cfg.truckId,
      shipmentId: this.trip?.phase === 'DRIVING' ? this.trip.dispatch.shipmentId : null,
      position: this.position,
      speedKmh,
      cargoTempC: this.cargoTempC,
      fuelPct: this.fuelPct,
      progress,
      etaSeconds,
      ts: new Date().toISOString(),
    };
    // QoS 0: leitura perdida e substituida pela proxima em 2s
    this.client?.publish(topics.telemetry(this.cfg.truckId), JSON.stringify(telemetry), { qos: 0 });

    if (this.trip?.phase === 'DRIVING' && progress >= 1) {
      this.publishEvent('DELIVERED', this.trip.dispatch.shipmentId);
      this.trip = null;
      if (this.fuelPct < 20) this.fuelPct = 100; // abastece no CD
      this.publishStatus(true);
    }
  }

  // Desligamento limpo: avisa offline (o Last Will so dispara em queda)
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.publishStatus(false);
    await this.client?.endAsync();
  }
}

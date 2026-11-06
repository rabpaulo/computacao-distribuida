import mqtt, { MqttClient } from 'mqtt';
import { hostname } from 'node:os';
import {
  DispatchMessage,
  TelemetryMessage,
  TruckEventMessage,
  TruckStatusMessage,
  topics,
  truckIdFromTopic,
  wildcards,
} from './topics';

// Lado "nuvem" do IoT: conecta no broker MQTT, acompanha quais caminhoes
// estao online e entrega pro ShipmentService o que chega deles.

export interface TruckState {
  truckId: string;
  online: boolean;
  shipments: string[];
  lastSeen: string;
  position: { lat: number; lng: number } | null;
  speedKmh: number | null;
  cargoTempC: number | null;
  fuelPct: number | null;
}

export interface FleetHandlers {
  onTruckStatus: (msg: TruckStatusMessage) => Promise<void>;
  onTelemetry: (msg: TelemetryMessage) => Promise<void>;
  onTruckEvent: (msg: TruckEventMessage) => Promise<void>;
}

// Com varias replicas do logistics-service, cada leitura de telemetria e
// cada evento deve ser processado por UMA replica so. Shared subscription
// ($share/<grupo>/<filtro>) faz o broker balancear entre elas.
// O status e retained, e retained nao e entregue em shared subscription,
// entao esse fica numa assinatura normal (toda replica precisa ver a frota).
// Grupo vazio desliga o recurso (para brokers sem suporte a $share).

export class FleetGateway {
  private client: MqttClient | null = null;
  private handlers: FleetHandlers | null = null;
  private readonly trucks = new Map<string, TruckState>();

  constructor(
    private readonly url: string,
    private readonly sharedGroup = 'logistics'
  ) {}

  private shared(filter: string): string {
    return this.sharedGroup ? `$share/${this.sharedGroup}/${filter}` : filter;
  }

  setHandlers(handlers: FleetHandlers): void {
    this.handlers = handlers;
  }

  isHealthy(): boolean {
    return this.client?.connected ?? false;
  }

  connect(): void {
    if (this.client) return;

    this.client = mqtt.connect(this.url, {
      clientId: `logistics-${hostname()}-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      console.log(`[logistics-service][mqtt] Conectado em ${this.url}`);
      this.client!.subscribe(
        {
          [wildcards.status]: { qos: 1 },
          [this.shared(wildcards.telemetry)]: { qos: 0 },
          [this.shared(wildcards.events)]: { qos: 1 },
        },
        (err) => {
          if (err) console.error('[logistics-service][mqtt] Falha ao assinar tópicos:', err.message);
          else console.log('[logistics-service][mqtt] Assinando status, telemetria e eventos da frota.');
        }
      );
    });

    this.client.on('reconnect', () => console.warn('[logistics-service][mqtt] Reconectando...'));
    this.client.on('error', (err) => console.warn('[logistics-service][mqtt] Erro:', err.message));

    this.client.on('message', (topic, payload) => {
      void this.route(topic, payload);
    });
  }

  private async route(topic: string, payload: Buffer): Promise<void> {
    const truckId = truckIdFromTopic(topic);
    if (!truckId || !this.handlers) return;

    // Retained vazio = status apagado
    if (payload.length === 0) return;

    let data: any;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      console.warn(`[logistics-service][mqtt] Payload inválido em ${topic}`);
      return;
    }

    try {
      if (topic.endsWith('/status')) {
        const msg = data as TruckStatusMessage;
        const prev = this.trucks.get(truckId);
        this.trucks.set(truckId, {
          truckId,
          online: Boolean(msg.online),
          shipments: msg.shipments ?? [],
          lastSeen: msg.ts ?? new Date().toISOString(),
          position: prev?.position ?? null,
          speedKmh: prev?.speedKmh ?? null,
          cargoTempC: prev?.cargoTempC ?? null,
          fuelPct: prev?.fuelPct ?? null,
        });
        if (prev?.online !== msg.online) {
          console.log(`[logistics-service][mqtt] Caminhão ${truckId} ${msg.online ? 'ONLINE' : 'OFFLINE'}`);
        }
        await this.handlers.onTruckStatus({ ...msg, truckId });
      } else if (topic.endsWith('/telemetry')) {
        const msg = data as TelemetryMessage;
        const truck = this.trucks.get(truckId);
        if (truck) {
          truck.position = msg.position;
          truck.speedKmh = msg.speedKmh;
          truck.cargoTempC = msg.cargoTempC;
          truck.fuelPct = msg.fuelPct;
          truck.lastSeen = msg.ts;
        }
        await this.handlers.onTelemetry({ ...msg, truckId });
      } else if (topic.endsWith('/events')) {
        await this.handlers.onTruckEvent({ ...(data as TruckEventMessage), truckId });
      }
    } catch (err) {
      console.error(`[logistics-service][mqtt] Erro ao processar ${topic}:`, (err as Error).message);
    }
  }

  // QoS 1: o broker guarda a mensagem na sessao persistente do caminhao se
  // ele estiver offline e entrega quando ele reconectar.
  dispatch(truckId: string, message: DispatchMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Cliente MQTT não inicializado'));
        return;
      }
      this.client.publish(topics.dispatch(truckId), JSON.stringify(message), { qos: 1 }, (err) =>
        err ? reject(err) : resolve()
      );
    });
  }

  onlineTrucks(): TruckState[] {
    return [...this.trucks.values()].filter((t) => t.online);
  }

  listTrucks(): TruckState[] {
    return [...this.trucks.values()].sort((a, b) => a.truckId.localeCompare(b.truckId));
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.endAsync();
    this.client = null;
  }
}

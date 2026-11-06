import React from 'react';
import { Shipment, GeoPoint } from '../types';
import { Truck, Thermometer, Gauge, Clock, MapPin, CheckCircle2 } from 'lucide-react';

const STEPS: Array<{ key: Shipment['status']; label: string }> = [
  { key: 'ASSIGNED', label: 'Despachado' },
  { key: 'IN_TRANSIT', label: 'Em trânsito' },
  { key: 'DELIVERED', label: 'Entregue' },
];

const ORDER: Record<Shipment['status'], number> = {
  AWAITING_TRUCK: -1,
  ASSIGNED: 0,
  IN_TRANSIT: 1,
  DELIVERED: 2,
};

const TEMP_ALERT_C = 30;

// Mini-mapa: projeta CD, destino e caminhão num SVG pequeno
const RouteMap: React.FC<{ shipment: Shipment }> = ({ shipment }) => {
  const { origin, destination } = shipment;
  const truck = shipment.current_position ?? origin;
  const points = [origin, destination, truck];

  const pad = 0.15;
  const minLat = Math.min(...points.map((p) => p.lat));
  const maxLat = Math.max(...points.map((p) => p.lat));
  const minLng = Math.min(...points.map((p) => p.lng));
  const maxLng = Math.max(...points.map((p) => p.lng));
  const spanLat = Math.max(maxLat - minLat, 0.001);
  const spanLng = Math.max(maxLng - minLng, 0.001);

  const W = 240;
  const H = 90;
  const project = (p: GeoPoint) => ({
    x: (pad + ((p.lng - minLng) / spanLng) * (1 - 2 * pad)) * W,
    // latitude cresce para o norte, y do SVG cresce para baixo
    y: (pad + ((maxLat - p.lat) / spanLat) * (1 - 2 * pad)) * H,
  });

  const o = project(origin);
  const d = project(destination);
  const t = project(truck);

  return (
    <svg className="route-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Posição do caminhão na rota">
      <line x1={o.x} y1={o.y} x2={d.x} y2={d.y} className="route-line" />
      <circle cx={o.x} cy={o.y} r={4} className="route-origin" />
      <circle cx={d.x} cy={d.y} r={5} className="route-destination" />
      {shipment.status !== 'AWAITING_TRUCK' && (
        <circle cx={t.x} cy={t.y} r={6} className={`route-truck ${shipment.status === 'DELIVERED' ? 'done' : ''}`} />
      )}
      <text x={o.x} y={o.y - 8} className="route-label" textAnchor="middle">CD</text>
      <text x={d.x} y={d.y - 9} className="route-label" textAnchor="middle">Você</text>
    </svg>
  );
};

export const ShipmentTracker: React.FC<{ shipment: Shipment | undefined }> = ({ shipment }) => {
  if (!shipment) {
    return (
      <div className="shipment-box shipment-waiting">
        <Truck size={14} />
        <span>Preparando envio...</span>
      </div>
    );
  }

  const current = ORDER[shipment.status];
  const hot = shipment.cargo_temp_c !== null && shipment.cargo_temp_c > TEMP_ALERT_C;

  return (
    <div className="shipment-box">
      <div className="shipment-head">
        <span className="shipment-title">
          <Truck size={14} />
          {shipment.status === 'AWAITING_TRUCK'
            ? 'Aguardando caminhão disponível'
            : `Caminhão ${shipment.truck_id}`}
        </span>
        <span className="shipment-mqtt-tag">MQTT</span>
      </div>

      <div className="shipment-steps">
        {STEPS.map((step, i) => (
          <div key={step.key} className={`shipment-step ${i <= current ? 'done' : ''} ${i === current ? 'current' : ''}`}>
            <span className="step-dot">{i < current || shipment.status === 'DELIVERED' ? <CheckCircle2 size={11} /> : null}</span>
            <span>{step.label}</span>
          </div>
        ))}
      </div>

      <div className="shipment-progress">
        <div className="shipment-progress-fill" style={{ width: `${Math.round(shipment.progress * 100)}%` }} />
      </div>

      <RouteMap shipment={shipment} />

      {shipment.status === 'IN_TRANSIT' && (
        <div className="shipment-sensors">
          <span><Gauge size={12} /> {shipment.speed_kmh?.toFixed(0) ?? '—'} km/h</span>
          <span className={hot ? 'sensor-alert' : ''}>
            <Thermometer size={12} /> {shipment.cargo_temp_c?.toFixed(1) ?? '—'}°C
          </span>
          <span><Clock size={12} /> {shipment.eta_seconds !== null ? `${shipment.eta_seconds}s` : '—'}</span>
        </div>
      )}

      {shipment.status === 'DELIVERED' && shipment.delivered_at && (
        <div className="shipment-sensors">
          <span>
            <MapPin size={12} /> Entregue às{' '}
            {new Date(shipment.delivered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  );
};

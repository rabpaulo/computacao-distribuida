// AWAITING_TRUCK: nenhum caminhao online para receber
// ASSIGNED:       despachada para um caminhao, aguardando coleta no CD
// IN_TRANSIT:     coletada, caminhao a caminho
// DELIVERED:      entregue
export type ShipmentStatus = 'AWAITING_TRUCK' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED';

export interface Shipment {
  id: string;
  order_id: string;
  user_id: string;
  status: ShipmentStatus;
  truck_id: string | null;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  current_position: { lat: number; lng: number } | null;
  progress: number;
  speed_kmh: number | null;
  cargo_temp_c: number | null;
  eta_seconds: number | null;
  last_telemetry_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ShipmentEvent {
  id: number;
  type: string;
  description: string;
  lat: number | null;
  lng: number | null;
  created_at: Date;
}

export type UserRole = 'ROLE_CUSTOMER' | 'ROLE_ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  active?: boolean;
  images?: string[];
  attributes?: Record<string, any>;
  createdAt?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  user_id: string;
  total_amount: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  created_at: string;
  items?: OrderItem[];
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureRate: number;
  bufferedCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  lastStateChange: string;
  retryAt: string | null;
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  data?: {
    circuitBreakers?: CircuitBreakerSnapshot[];
    trucksOnline?: number;
  };
}

export interface Payment {
  id: string;
  order_id: string;
  amount: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  method: 'PAYPAL';
  reason: string | null;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  created_at: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Shipment {
  id: string;
  order_id: string;
  status: 'AWAITING_TRUCK' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED';
  truck_id: string | null;
  origin: GeoPoint;
  destination: GeoPoint;
  current_position: GeoPoint | null;
  progress: number;
  speed_kmh: number | null;
  cargo_temp_c: number | null;
  eta_seconds: number | null;
  last_telemetry_at: string | null;
  delivered_at: string | null;
}

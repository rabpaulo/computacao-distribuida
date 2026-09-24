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

export interface ServiceHealth {
  name: string;
  url: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
}

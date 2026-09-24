export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  user_id: string;
  total_amount: number;
  status: OrderStatus;
  created_at: Date;
  updated_at: Date;
  items?: OrderItem[];
}

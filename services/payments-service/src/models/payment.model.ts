export type PaymentStatus = 'APPROVED' | 'REJECTED';

export interface Payment {
  id: string;
  order_id: string;
  user_id: string;
  amount: number;
  status: PaymentStatus;
  reason: string | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

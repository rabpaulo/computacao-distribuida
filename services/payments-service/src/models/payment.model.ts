// PENDING_APPROVAL: ordem criada no PayPal, esperando o comprador aprovar
export type PaymentStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type PaymentMethod = 'PAYPAL';

export interface Payment {
  id: string;
  order_id: string;
  user_id: string;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  reason: string | null;
  attempts: number;
  // Id da ordem no PayPal (simulado) e da captura, quando houver
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  created_at: Date;
  updated_at: Date;
}

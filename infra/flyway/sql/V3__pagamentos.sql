-- payments-service: pagamentos (fluxo assíncrono via RabbitMQ + PayPal simulado).

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  reason TEXT,
  attempts INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- É o índice único que impede cobrar o mesmo pedido duas vezes quando o broker
-- reentrega a mensagem.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

-- Colunas do fluxo PayPal. O ADD COLUMN IF NOT EXISTS cobre bancos criados nas
-- entregas anteriores, em que a tabela existia sem elas.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method VARCHAR(20) NOT NULL DEFAULT 'PAYPAL';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paypal_order_id VARCHAR(40);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(40);

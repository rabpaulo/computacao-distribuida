-- notifications-service: notificações em tempo real e o vínculo pedido -> dono.

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  -- Id do evento que originou a notificação: reentrega do broker não duplica
  event_id VARCHAR(36) NOT NULL UNIQUE,
  type VARCHAR(40) NOT NULL,
  level VARCHAR(10) NOT NULL DEFAULT 'info',
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  order_id VARCHAR(36),
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Os eventos de pagamento não trazem o userId. Guardamos quem é o dono de cada
-- pedido (vindo de order.created) para saber a quem avisar.
CREATE TABLE IF NOT EXISTS order_owners (
  order_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_owners_user ON order_owners(user_id);

-- Primeira migration "de evolução": sem Flyway, uma mudança como esta exigiria
-- mexer no código de criação das tabelas e torcer para rodar em todos os bancos.
--
-- As telas "Meus pedidos", "Meus pagamentos" e "Minhas entregas" listam por
-- usuário e ordenam por data (WHERE user_id = ? ORDER BY created_at DESC). Um
-- índice composto atende filtro e ordenação de uma vez, sem ordenar na memória.
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_user_created ON shipments(user_id, created_at DESC);

-- A listagem de usuários do administrador ignora contas anonimizadas
-- (WHERE anonymized_at IS NULL ORDER BY created_at DESC). O índice parcial só
-- guarda as contas ativas.
CREATE INDEX IF NOT EXISTS idx_users_ativos_created ON users(created_at DESC) WHERE anonymized_at IS NULL;

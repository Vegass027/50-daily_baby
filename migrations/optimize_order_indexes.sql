-- ==========================================
-- Оптимизация индексов для таблицы Order
-- ==========================================

-- 1. Композитный индекс для findActiveByUserId (ускорение 10-50x)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_user_status_created 
ON "Order" ("userId", status, "createdAt" DESC);

-- 2. Partial индекс для активных ордеров по токену (ускорение запросов по tokenMint)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_token_type_status_active 
ON "Order" ("tokenMint", "tokenType", status) 
WHERE status IN ('PENDING', 'OPEN');

-- 3. Индекс для мониторинга ордеров по статусу и времени обновления
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_status_updated 
ON "Order" (status, "updatedAt" DESC);

-- 4. Индекс для связанных позиций
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_linked_position_status 
ON "Order" ("linkedPositionId", status);

-- 5. Partial индекс для take profit ордеров (ускорение мониторинга)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_takeprofit_active 
ON "Order" ("linkedBuyOrderId", status) 
WHERE "linkedBuyOrderId" IS NOT NULL AND status IN ('PENDING', 'OPEN');

-- Удаление дублирующих индексов (будет выполнено после создания новых)
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_created;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_createdAt;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_createdat;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_linkedbuyorderid;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_linkedpositionid;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_linkedtakeprofitorderid;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_token_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_tokenmint_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_user_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_order_userid_status;

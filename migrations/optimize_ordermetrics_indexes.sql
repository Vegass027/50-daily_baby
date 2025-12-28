-- ==========================================
-- Оптимизация индексов для таблицы OrderMetrics
-- ==========================================

-- 1. Композитный индекс для аналитики по пользователю и успеху
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ordermetrics_user_success_timestamp 
ON "OrderMetrics" ("userId", success, "timestamp" DESC);

-- 2. Partial индекс для успешных транзакций (ускорение метрик успеха)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ordermetrics_success_timestamp 
ON "OrderMetrics" ("timestamp" DESC) 
WHERE success = true;

-- 3. Partial индекс для неудачных транзакций (ускорение анализа ошибок)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ordermetrics_failed_timestamp 
ON "OrderMetrics" ("timestamp" DESC) 
WHERE success = false;

-- 4. Композитный индекс для поиска по ордеру и времени
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ordermetrics_order_timestamp 
ON "OrderMetrics" ("orderId", "timestamp" DESC);

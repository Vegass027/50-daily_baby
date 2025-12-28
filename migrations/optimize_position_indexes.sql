-- ==========================================
-- Оптимизация индексов для таблицы Position
-- ==========================================

-- 1. Композитный индекс для поиска позиций пользователя по статусу и времени
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_position_user_status_updated 
ON "Position" ("userId", "updatedAt" DESC);

-- 2. Partial индекс только для открытых позиций (size > 0)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_position_user_open 
ON "Position" ("userId", "tokenAddress", "updatedAt" DESC) 
WHERE size > 0;

-- 3. Индекс для мониторинга всех позиций по статусу
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_position_status_updated 
ON "Position" ("updatedAt" DESC);

-- 4. Индекс для поиска по токену
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_position_token_updated 
ON "Position" ("tokenAddress", "updatedAt" DESC);

-- Удаление избыточных индексов (будет выполнено после создания новых)
-- DROP INDEX CONCURRENTLY IF EXISTS Position_userId_tokenAddress_idx;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_position_token;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_position_user;

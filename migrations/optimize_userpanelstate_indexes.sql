-- ==========================================
-- Оптимизация индексов для таблицы UserPanelState
-- ==========================================

-- 1. Индекс для поиска активных панелей пользователя
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_userpanelstate_user_closed_updated 
ON "UserPanelState" ("userId", closed, "updatedAt" DESC);

-- 2. Partial индекс только для открытых панелей (ускорение активных сессий)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_userpanelstate_active 
ON "UserPanelState" ("userId", "updatedAt" DESC) 
WHERE closed = false;

-- 3. Индекс для поиска по токену
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_userpanelstate_token_updated 
ON "UserPanelState" ("tokenAddress", "updatedAt" DESC);

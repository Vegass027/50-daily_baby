-- Миграция: Изменение foreign key constraints на CASCADE
-- Дата: 2025-01-XX
-- Описание: При удалении Position автоматически удаляются связанные Trade и LinkedOrder

-- Примечание: Foreign keys уже существуют с CASCADE, эта миграция для проверки

-- Проверяем текущие constraints
SELECT
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  confrelid::regclass AS referenced_table,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass IN ('"Trade"', '"LinkedOrder"')
  AND contype = 'f';

-- Если нужно изменить, раскомментируйте следующие строки:

-- Удаляем старые constraints
-- ALTER TABLE public."Trade"
-- DROP CONSTRAINT IF EXISTS Trade_positionId_fkey;

-- ALTER TABLE public."LinkedOrder"
-- DROP CONSTRAINT IF EXISTS LinkedOrder_positionId_fkey;

-- Создаем новые constraints с ON DELETE CASCADE
-- ALTER TABLE public."Trade"
-- ADD CONSTRAINT Trade_positionId_fkey
--   FOREIGN KEY ("positionId")
--   REFERENCES public."Position"(id)
--   ON UPDATE CASCADE
--   ON DELETE CASCADE;

-- ALTER TABLE public."LinkedOrder"
-- ADD CONSTRAINT LinkedOrder_positionId_fkey
--   FOREIGN KEY ("positionId")
--   REFERENCES public."Position"(id)
--   ON UPDATE CASCADE
--   ON DELETE CASCADE;

-- Добавляем комментарий
-- COMMENT ON CONSTRAINT Trade_positionId_fkey ON public."Trade" IS
--   'Foreign key to Position with CASCADE delete';

-- COMMENT ON CONSTRAINT LinkedOrder_positionId_fkey ON public."LinkedOrder" IS
--   'Foreign key to Position with CASCADE delete';

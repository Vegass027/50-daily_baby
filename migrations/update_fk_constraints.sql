-- Миграция: Обновление Foreign Key constraints с RESTRICT на CASCADE
-- Дата: 2024-01-XX
-- Описание: Добавляет ON DELETE CASCADE для связей Position -> Trade и Position -> LinkedOrder

-- Удалить старые foreign keys
ALTER TABLE public."Trade"
DROP CONSTRAINT IF EXISTS "Trade_positionId_fkey";

ALTER TABLE public."LinkedOrder"
DROP CONSTRAINT IF EXISTS "LinkedOrder_positionId_fkey";

-- Создать новые foreign keys с ON DELETE CASCADE
ALTER TABLE public."Trade"
ADD CONSTRAINT "Trade_positionId_fkey"
  FOREIGN KEY ("positionId")
  REFERENCES public."Position"(id)
  ON DELETE CASCADE;

ALTER TABLE public."LinkedOrder"
ADD CONSTRAINT "LinkedOrder_positionId_fkey"
  FOREIGN KEY ("positionId")
  REFERENCES public."Position"(id)
  ON DELETE CASCADE;

-- Проверка новых constraints
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('Trade', 'LinkedOrder')
ORDER BY tc.table_name, tc.constraint_name;

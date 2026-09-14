-- Этап 2 ТЗ 12.09.2026 (`У-203`): еженедельный повтор переноса заводится НА
-- ПАУЗЕ. Без этой строки расписание включилось бы само при первом же запуске
-- воркера — и портал начали бы перечитывать раньше, чем человек решил, что
-- параллельный период начался.
INSERT INTO "SyncSchedulePause" ("schedulerId", "pausedBy", "pausedAt")
VALUES ('bitrix.resync', 'system', NOW())
ON CONFLICT ("schedulerId") DO NOTHING;

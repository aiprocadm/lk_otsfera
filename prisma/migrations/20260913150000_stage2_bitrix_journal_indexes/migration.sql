-- Этап 2 ТЗ 12.09.2026 (`У-196`): откат читает журнал пакета порциями по
-- сущности в обратном порядке, а кнопка «Откатить» считает неоткаченные
-- строки. Индексы под эти два запроса; старый [batchId, entity] — префикс
-- нового, поэтому снимается.
DROP INDEX IF EXISTS "BitrixImportWrite_batchId_entity_idx";
CREATE INDEX "BitrixImportWrite_batchId_entity_createdAt_idx" ON "BitrixImportWrite"("batchId", "entity", "createdAt");
CREATE INDEX "BitrixImportWrite_batchId_reverted_idx" ON "BitrixImportWrite"("batchId", "reverted");

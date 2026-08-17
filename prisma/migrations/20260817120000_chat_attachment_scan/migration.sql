-- Антивирус для вложений клиентского чата (спека 2026-08-17-chat-attachment-scan).
-- До этой миграции вложения Message не проверялись вовсе: канал «клиент грузит —
-- сотрудник открывает» был единственным без ClamAV.

-- Дефолт 'none', а не 'pending': сообщения без вложения сканировать нечего, а
-- default 'pending' пометил бы их все и завалил часовой backfill-sweep
-- (образец дефолта — StaffMessage/InboundMessage).
ALTER TABLE "Message" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'none';

-- Существующие настоящие вложения (ключи chat/<orderId>/…) — в очередь на скан:
-- их подберёт часовой sweep (scanStatus='pending' AND attachmentPath IS NOT NULL).
-- Legacy-строки бэкфилла Comment→Message несут чужие пути (orders/… и т.п.):
-- их скачивание и так отрезано префикс-гардом 'chat/', а сами файлы
-- сканируются в своём канале (Document) — оставляем 'none'.
UPDATE "Message" SET "scanStatus" = 'pending'
WHERE "attachmentPath" LIKE 'chat/%';

-- Индекс под запрос sweep'а (и админский фильтр «только заражённые») — как у
-- Document/LeadAttachment. CONCURRENTLY нельзя: Prisma выполняет миграцию в
-- транзакции; таблица переживает короткую блокировку.
CREATE INDEX "Message_scanStatus_idx" ON "Message"("scanStatus");

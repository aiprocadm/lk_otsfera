-- Этап 5 PR-3 (У-231, Р-Э5-5): дедупликация уведомлений.
-- Аддитивно и обратимо: три nullable/дефолтные колонки и два индекса.
ALTER TABLE "Notification" ADD COLUMN "entityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "dedupCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Notification" ADD COLUMN "lastOccurredAt" TIMESTAMP(3);

-- Прежние строки: «последний повтор» = момент создания, чтобы сортировка ленты
-- по lastOccurredAt не утопила старые уведомления под новыми.
UPDATE "Notification" SET "lastOccurredAt" = "createdAt" WHERE "lastOccurredAt" IS NULL;

CREATE INDEX "Notification_userId_type_entityId_createdAt_idx" ON "Notification"("userId", "type", "entityId", "createdAt");
CREATE INDEX "Notification_userId_lastOccurredAt_idx" ON "Notification"("userId", "lastOccurredAt");

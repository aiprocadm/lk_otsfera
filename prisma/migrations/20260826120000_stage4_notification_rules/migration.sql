-- Этап 4 ТЗ 2026-08-21 (`У-127`): правила маршрутизации уведомлений.
--
-- Таблица хранит ТОЛЬКО отклонения от реестра в коде — он остаётся значением
-- по умолчанию. Поэтому бэкфилла нет и не нужно: пустая таблица означает
-- ровно прежнее поведение, а откат (revert PR) просто перестаёт её читать.
--
-- `companyId = NULL` — правило платформы, заполненный — правило компании.
-- Уникальность по четвёрке (компания, событие, роль, канал) не даёт завести
-- два противоречивых правила об одном и том же.

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "eventType" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationRule_companyId_idx" ON "NotificationRule"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRule_companyId_eventType_audience_channel_key" ON "NotificationRule"("companyId", "eventType", "audience", "channel");

-- ВАЖНО: составной уникальный индекс выше НЕ защищает платформенные правила.
-- В Postgres два NULL не считаются равными, поэтому строк с `companyId IS NULL`
-- и одинаковой тройкой (событие, роль, канал) могло бы появиться сколько
-- угодно — и какое из них подействует, решал бы порядок выборки.
--
-- Частичный уникальный индекс закрывает ровно этот случай. Prisma частичные
-- индексы не описывает, поэтому он живёт здесь, а код пишет правила через
-- «найти и обновить», а не через upsert по составному ключу.
CREATE UNIQUE INDEX "NotificationRule_platform_key"
  ON "NotificationRule" ("eventType", "audience", "channel")
  WHERE "companyId" IS NULL;

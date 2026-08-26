-- Этап 4 ТЗ 2026-08-21 (`У-128`): свои тексты писем и сообщений.
--
-- Таблица хранит ТОЛЬКО переопределения: отсутствие записи означает «письмо
-- собирает программа, как раньше». Поэтому бэкфилла нет, а откат (revert PR)
-- просто перестаёт её читать.
--
-- Как и у правил (`У-127`), составной уникальный ключ не защищает шаблоны
-- ПЛАТФОРМЫ: в Postgres два NULL не равны. Частичный индекс ниже закрывает
-- ровно этот случай.

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "templateKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationTemplate_companyId_idx" ON "NotificationTemplate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_companyId_templateKey_key" ON "NotificationTemplate"("companyId", "templateKey");


CREATE UNIQUE INDEX "NotificationTemplate_platform_key"
  ON "NotificationTemplate" ("templateKey")
  WHERE "companyId" IS NULL;

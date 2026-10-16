-- Этап 5 ТЗ 13.10.2026 «Задачи» (`У-299`, `Р-5-1`, `Р-5-3`, `Р-5-4`).
--
-- Только добавление (`Р-ПМ-5`): новый тип, четыре колонки и одна таблица.
-- Существующие строки не меняются: прежние исполнители получают роль
-- `executor` значением по умолчанию, у старых задач нет ни результата, ни тегов.
-- Откат — DROP новых колонок, таблицы и типа.

CREATE TYPE "TaskAssigneeRole" AS ENUM ('executor', 'co_executor');
ALTER TABLE "TaskAssignee" ADD COLUMN "role" "TaskAssigneeRole" NOT NULL DEFAULT 'executor';

ALTER TABLE "Task" ADD COLUMN "result" TEXT;
ALTER TABLE "Task" ADD COLUMN "resultUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "TaskResultFile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "scanReason" TEXT,
    "scannedAt" TIMESTAMP(3),

    CONSTRAINT "TaskResultFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskResultFile_taskId_idx" ON "TaskResultFile"("taskId");
CREATE INDEX "TaskResultFile_scanStatus_idx" ON "TaskResultFile"("scanStatus");

ALTER TABLE "TaskResultFile" ADD CONSTRAINT "TaskResultFile_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskResultFile" ADD CONSTRAINT "TaskResultFile_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

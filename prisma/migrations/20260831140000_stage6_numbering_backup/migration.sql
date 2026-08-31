-- Этап 6 (`У-151`): таблица «до» для отката разбора исторических номеров.
--
-- Заводится ОТДЕЛЬНОЙ миграцией, до самой чистки: скрипт `fix:document-numbers`
-- пишет сюда прежние значения, а миграция ограничений идёт уже после него.
-- Пустая таблица ничего не значит и ничему не мешает.
CREATE TABLE "DocumentNumberingBackup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,

    CONSTRAINT "DocumentNumberingBackup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentNumberingBackup_documentId_idx" ON "DocumentNumberingBackup"("documentId");
CREATE INDEX "DocumentNumberingBackup_createdAt_idx" ON "DocumentNumberingBackup"("createdAt");

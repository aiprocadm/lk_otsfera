-- Этап 6 (`У-160`): свои тексты абзацев договора и доп. соглашения.
-- Миграция чисто аддитивная: ни одной существующей строки не трогает.
-- Бэкфилла нет намеренно — пустая таблица означает «печатаем встроенным
-- текстом», то есть ровно сегодняшнее поведение.

-- Выдатчик номеров редакций. Растёт на каждое сохранение и на каждый сброс,
-- никогда не переиспользуется: два разных текста не должны носить один номер.
ALTER TABLE "Company" ADD COLUMN "documentTemplateRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- Один абзац компании — одна строка. Второй строки того же слота быть не может.
CREATE UNIQUE INDEX "DocumentTemplate_companyId_slot_key" ON "DocumentTemplate"("companyId", "slot");
CREATE INDEX "DocumentTemplate_companyId_idx" ON "DocumentTemplate"("companyId");

-- Cascade: у удалённой компании собственных текстов договора быть не может.
ALTER TABLE "DocumentTemplate"
  ADD CONSTRAINT "DocumentTemplate_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Пустой текст абзаца бессмыслен: «нет своего текста» выражается ОТСУТСТВИЕМ
-- строки, а не пустой строкой. Без этой проверки появились бы два разных
-- способа сказать одно и то же, и сброс перестал бы быть однозначным.
ALTER TABLE "DocumentTemplate"
  ADD CONSTRAINT "DocumentTemplate_body_not_blank" CHECK (btrim("body") <> '');

-- Редакция — положительное число: ноль зарезервирован за смыслом
-- «печатали встроенным текстом» в Document.templateVersion.
ALTER TABLE "DocumentTemplate"
  ADD CONSTRAINT "DocumentTemplate_revision_positive" CHECK ("revision" >= 1);

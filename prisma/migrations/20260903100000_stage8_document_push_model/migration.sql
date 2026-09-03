-- Этап 8 (`У-168`, `У-169`): выгрузка документов в 1С — состояние на документе
-- и правило у компании. Миграция аддитивная: ни одной существующей строки не
-- меняет, все новые колонки с умолчаниями либо пустые.
--
-- Оба перечисления создаются ЦЕЛИКОМ здесь же и здесь же используются — это
-- разрешено. Запрет Postgres («unsafe use of new value of enum type», урок
-- этапа 7) касается только ДОБАВЛЕНИЯ значения в уже существующий тип. Именно
-- поэтому `exported_file` (`У-173`, файловый канал, PR-9) заведено сразу:
-- иначе PR-9 понадобилась бы вторая миграция ради одного значения.

-- Состояние выгрузки — одно на все каналы: «выгружен файлом» и «выгружен по
-- API» друг друга исключают, два независимых поля разошлись бы.
CREATE TYPE "OneCPushStatus" AS ENUM ('none', 'pending', 'pushed', 'failed', 'skipped', 'exported_file');

-- Правило выгрузки у компании: автоматически при выпуске · только по кнопке ·
-- никогда. Умолчание `manual` — компания, которая ничего не настроила, не
-- должна начать слать бумаги в чужую систему молча.
CREATE TYPE "OneCDocumentPushMode" AS ENUM ('auto', 'manual', 'never');

-- `У-169`: правило у каждой компании своё. Глобальная `IntegrationSetting` не
-- подходит — у неё нет `companyId`. Набор типов по умолчанию — все четыре,
-- которые вообще уезжают в 1С: счёт, акт, договор, ДС.
ALTER TABLE "Company"
  ADD COLUMN "oneCDocumentPushMode" "OneCDocumentPushMode" NOT NULL DEFAULT 'manual',
  ADD COLUMN "oneCDocumentPushTypes" "DocumentType"[] DEFAULT ARRAY['invoice', 'act', 'contract', 'extra_agreement']::"DocumentType"[];

-- Проверка 1. В наборе только те четыре типа, что выгружаются в 1С. КП —
-- предпродажный документ и в бухгалтерии ему делать нечего (`Р-14`); прочие
-- типы (накладная, удостоверение, отчёт, комиссионный акт) контракт `У-167`
-- не описывает. Интерфейс это тоже проверит, но кнопку можно позвать мимо
-- экрана — запрет живёт в базе. `<@` — «левый массив целиком содержится в
-- правом».
ALTER TABLE "Company"
  ADD CONSTRAINT "Company_oneCDocumentPushTypes_pushable" CHECK (
    "oneCDocumentPushTypes" <@ ARRAY['invoice', 'act', 'contract', 'extra_agreement']::"DocumentType"[]
  );

-- `У-168`: шесть полей о выгрузке. `oneCExternalId` — идентификатор бумаги В
-- 1С; НЕ уникален: в 1С уезжает id ПЕРВОЙ версии цепочки перевыпусков, и все
-- версии одной цепочки делят один идентификатор — так перевыпуск приезжает в
-- 1С обновлением, а не вторым документом.
ALTER TABLE "Document"
  ADD COLUMN "oneCExternalId" TEXT,
  ADD COLUMN "oneCPushStatus" "OneCPushStatus" NOT NULL DEFAULT 'none',
  ADD COLUMN "oneCPushedAt" TIMESTAMP(3),
  ADD COLUMN "oneCPushAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "oneCPushError" TEXT,
  ADD COLUMN "oneCPushedVersion" INTEGER;

-- Фильтр списка по статусу выгрузки и ежедневная сверка (`У-172`) ходят по
-- статусу; входящий поток (`У-170`) ищет свой документ по идентификатору 1С.
CREATE INDEX "Document_oneCPushStatus_idx" ON "Document"("oneCPushStatus");
CREATE INDEX "Document_oneCExternalId_idx" ON "Document"("oneCExternalId");

-- Проверка 2. «Выгружен» — только вместе с временем и версией. На версии
-- держится идемпотентность (`У-167`): «та же версия — повтор не нужен, новая —
-- обновление». Документ в состоянии `pushed` без версии сравнивать не с чем,
-- и повтор либо создал бы в 1С второй экземпляр, либо навсегда пропускал бы
-- обновление.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_oneC_pushed_has_version" CHECK (
    "oneCPushStatus" <> 'pushed' OR
    ("oneCPushedAt" IS NOT NULL AND "oneCPushedVersion" IS NOT NULL)
  );

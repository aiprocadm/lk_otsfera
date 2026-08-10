-- Этап 6 (У-33, У-34, У-35): направление обучения переезжает с ШАПКИ заявки
-- на позицию. Пока поле НЕОБЯЗАТЕЛЬНОЕ: у старых заявок курс вписан текстом
-- (EnrollmentRequest.legacyCourseTitle), их разбирает человек (У-34а).
-- Обязательным поле сделает отдельная миграция-«замок» следующего PR.

-- 1. Само поле и связь.
ALTER TABLE "EnrollmentRequestItem" ADD COLUMN "directionId" TEXT;

ALTER TABLE "EnrollmentRequestItem"
  ADD CONSTRAINT "EnrollmentRequestItem_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "TrainingDirection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. У-34 (бэкфилл): направление шапки копируется во все её позиции.
-- Заявки с directionId IS NULL (курс вписан текстом) НЕ трогаем — их
-- разбирает администратор на одноразовом экране, служебное направление
-- «Без указания» не заводим (решение Р-8).
UPDATE "EnrollmentRequestItem" AS i
SET "directionId" = r."directionId"
FROM "EnrollmentRequest" AS r
WHERE i."requestId" = r."id"
  AND r."directionId" IS NOT NULL
  AND i."directionId" IS NULL;

-- 3. У-35: один сотрудник может быть в заявке несколько раз с РАЗНЫМИ
-- направлениями, но не дважды с одним и тем же. NULL-значения PostgreSQL
-- в уникальном индексе не сравнивает, поэтому позиции без слушателя или без
-- направления ограничению не мешают (это состояние временное — до «замка»).
CREATE UNIQUE INDEX "EnrollmentRequestItem_requestId_studentId_directionId_key"
  ON "EnrollmentRequestItem"("requestId", "studentId", "directionId");

CREATE INDEX "EnrollmentRequestItem_directionId_idx"
  ON "EnrollmentRequestItem"("directionId");

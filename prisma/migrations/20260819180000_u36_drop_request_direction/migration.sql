-- `У-36`: снятие шапочного направления заявки.
--
-- Направление живёт в позициях (`EnrollmentRequestItem.directionId`) с этапа 6,
-- бэкфилл `У-34` уже скопировал туда значение с шапки. Колонка оставалась
-- только ради отката и продолжала заполняться: сервис подачи требовал её
-- обязательной, а мастер клал туда направление ПЕРВОЙ строки. Пока она есть,
-- у заявки два источника правды.
--
-- Шаг 1 — страховка. У заявки может не быть ни одной позиции (исторические
-- записи). Для них подпись жила только в шапке, поэтому переносим название
-- направления в `legacyCourseTitle` — то самое поле, где у старых заявок
-- курс уже хранится текстом. Без этого шага такие заявки после DROP
-- остались бы без подписи вовсе.
UPDATE "EnrollmentRequest" AS r
SET "legacyCourseTitle" = COALESCE(r."legacyCourseTitle", d."name")
FROM "TrainingDirection" AS d
WHERE r."directionId" = d."id"
  AND NOT EXISTS (
    SELECT 1 FROM "EnrollmentRequestItem" AS i WHERE i."requestId" = r."id"
  );

-- Шаг 2 — снятие колонки вместе с индексом и внешним ключом.
DROP INDEX IF EXISTS "EnrollmentRequest_directionId_idx";
ALTER TABLE "EnrollmentRequest" DROP CONSTRAINT IF EXISTS "EnrollmentRequest_directionId_fkey";
ALTER TABLE "EnrollmentRequest" DROP COLUMN "directionId";

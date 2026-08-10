-- Этап 6, PR-3 «замок» (У-33, У-34а): направление позиции становится
-- ОБЯЗАТЕЛЬНЫМ. Предыдущая миграция (20260810100000) добавила поле и
-- перенесла в него направление шапки; старые заявки, где курс вписан текстом,
-- разбирает человек на экране /admin/enrollments/legacy.

-- 1. Страж. Без него ALTER ... SET NOT NULL упал бы сообщением PostgreSQL
-- про нарушение ограничения — по нему непонятно НИ что делать, НИ сколько
-- строк мешает. Поэтому проверяем сами и падаем понятным текстом (У-34а).
-- DDL в PostgreSQL транзакционный: при исключении миграция откатывается
-- целиком, база остаётся в прежнем состоянии.
DO $$
DECLARE
  broken_items  bigint;
  broken_requests bigint;
BEGIN
  SELECT count(*), count(DISTINCT "requestId")
    INTO broken_items, broken_requests
    FROM "EnrollmentRequestItem"
   WHERE "directionId" IS NULL;

  IF broken_items > 0 THEN
    RAISE EXCEPTION
      'Нельзя сделать направление обязательным: без направления % позиций в % заявках. Разберите их: запустите «npm run report:legacy-enrollments», затем проставьте направления на экране /admin/enrollments/legacy и повторите миграцию.',
      broken_items, broken_requests;
  END IF;
END $$;

-- 2. Сам «замок».
ALTER TABLE "EnrollmentRequestItem" ALTER COLUMN "directionId" SET NOT NULL;

-- 3. Позиция без направления больше невозможна, поэтому удаление направления
-- из справочника не имеет права обнулять её (ON DELETE SET NULL положил бы
-- NULL в NOT NULL-колонку и упал бы в момент удаления). Переводим связь на
-- RESTRICT: направление, на которое кого-то записали, удалить нельзя.
ALTER TABLE "EnrollmentRequestItem"
  DROP CONSTRAINT "EnrollmentRequestItem_directionId_fkey";

ALTER TABLE "EnrollmentRequestItem"
  ADD CONSTRAINT "EnrollmentRequestItem_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "TrainingDirection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

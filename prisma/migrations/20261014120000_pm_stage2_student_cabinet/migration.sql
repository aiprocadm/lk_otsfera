-- Этап 2 ТЗ 13.10.2026 «Кабинет слушателя» (`У-284`, `Р-2-1`…`Р-2-3`).
--
-- Только добавление (`Р-ПМ-5`): две необязательные колонки, индекс и внешний
-- ключ. Существующие строки не меняются; откат — DROP этих колонок.
--
-- 1. `Student.userId` — учётка слушателя, которой принадлежит карточка
--    справочника. Без этой связи слушателю нечего показать в кабинете и некого
--    уведомить о подтверждённой заявке (`Д-52`). Удаление учётки карточку не
--    удаляет — SET NULL.
-- 2. `EnrollmentRequestItem.startsOn` / `endsOn` — сроки обучения по позиции
--    (дата без времени). Раньше дат обучения в системе не было нигде.

ALTER TABLE "Student" ADD COLUMN "userId" TEXT;
CREATE INDEX "Student_userId_idx" ON "Student"("userId");
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnrollmentRequestItem" ADD COLUMN "startsOn" DATE;
ALTER TABLE "EnrollmentRequestItem" ADD COLUMN "endsOn" DATE;

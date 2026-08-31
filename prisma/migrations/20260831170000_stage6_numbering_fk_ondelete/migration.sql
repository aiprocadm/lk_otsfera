-- Этап 6 (`У-151`), поправка к `20260831160000_stage6_numbering_constraints`.
--
-- ЧТО БЫЛО НЕ ТАК. Составной ключ «документ → заказ» создавался без `ON DELETE`,
-- то есть с `NO ACTION`. Одиночный ключ по `orderId` при этом имеет
-- `ON DELETE SET NULL`, но строгий побеждает: удаление заказа, у которого есть
-- документы, начало падать ошибкой внешнего ключа. Раньше документ просто
-- терял привязку к заказу и оставался в системе — бумага не исчезает оттого,
-- что удалили заказ.
--
-- ЧИНИМ, НЕ ПЕРЕПИСЫВАЯ ПРИМЕНЁННУЮ МИГРАЦИЮ (правило репозитория): отдельным
-- шагом. Postgres 15+ умеет обнулять ЧАСТЬ ключа — `SET NULL ("orderId")`
-- обнуляет только заказ и не трогает компанию, которая объявлена NOT NULL.
-- Именно это нам и нужно: документ становится «без заказа», но остаётся при
-- своём юрлице.
ALTER TABLE "Document" DROP CONSTRAINT "Document_order_company_fkey";
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_order_company_fkey"
  FOREIGN KEY ("orderId", "companyId") REFERENCES "Order"("id", "companyId")
  ON UPDATE CASCADE ON DELETE SET NULL ("orderId");

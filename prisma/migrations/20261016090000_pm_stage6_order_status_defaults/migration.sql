-- Этап 6 ТЗ 13.10.2026 «Заказы» (`У-304`, `У-305`, `Р-6-1`, `Р-6-2`).
--
-- Только данные, схема не меняется (`Р-ПМ-5`). Трогаются лишь семь
-- системных общесистемных строк справочника (`isSystem`, `companyId IS NULL`);
-- статусы, заведённые заказчиком, остаются как есть.
--
-- 1. Воронка по умолчанию — четыре этапа в порядке работы.
-- 2. «Документы выданы» и «Бухгалтерия подписана» — факты, а не этапы:
--    строки остаются (якоря и история), но выключаются.
-- 3. Заказы, стоявшие на выключенных этапах, переходят на «Оплата поступила»
--    — ближайший этап перед закрытием — с записью в истории статусов.
-- 4. «Заявка закрыта» → «Заказ закрыт», если название не меняли.
--
-- Откат: вернуть `isActive`/`sortOrder` строкам и statusId заказам по
-- записям истории с причиной «Этап снят с воронки…».

UPDATE "OrderStatusDefinition" SET "sortOrder" = 1
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'draft';
UPDATE "OrderStatusDefinition" SET "sortOrder" = 2
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'accepted';
UPDATE "OrderStatusDefinition" SET "sortOrder" = 3
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'paid';
UPDATE "OrderStatusDefinition" SET "sortOrder" = 4
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'closed';
UPDATE "OrderStatusDefinition" SET "sortOrder" = 90
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'cancelled';

UPDATE "OrderStatusDefinition" SET "label" = 'Заказ закрыт'
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'closed' AND "label" = 'Заявка закрыта';

-- Заказы с выключаемых этапов — на «Оплата поступила», с историей.
INSERT INTO "OrderStatusChange" ("id", "createdAt", "orderId", "fromId", "toId", "userId", "reason")
SELECT
  'pm6_' || md5(o."id" || clock_timestamp()::text),
  CURRENT_TIMESTAMP,
  o."id",
  o."statusId",
  paid."id",
  NULL,
  'Этап снят с воронки: «Документы выданы» и «Бухгалтерия подписана» теперь отметки, а не этапы (ТЗ 13.10.2026, У-304)'
FROM "Order" o
JOIN "OrderStatusDefinition" s ON s."id" = o."statusId"
CROSS JOIN (
  SELECT "id" FROM "OrderStatusDefinition"
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'paid'
) paid
WHERE s."companyId" IS NULL AND s."isSystem" AND s."key" IN ('documents_issued', 'accounting_signed');

UPDATE "Order" o SET "statusId" = paid."id"
FROM "OrderStatusDefinition" s,
  (SELECT "id" FROM "OrderStatusDefinition"
   WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'paid') paid
WHERE s."id" = o."statusId"
  AND s."companyId" IS NULL AND s."isSystem" AND s."key" IN ('documents_issued', 'accounting_signed');

UPDATE "OrderStatusDefinition" SET "isActive" = false, "sortOrder" = 80
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'documents_issued';
UPDATE "OrderStatusDefinition" SET "isActive" = false, "sortOrder" = 81
  WHERE "companyId" IS NULL AND "isSystem" AND "key" = 'accounting_signed';

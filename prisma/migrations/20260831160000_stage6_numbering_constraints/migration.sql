-- Этап 6 (`У-151`): связи и уникальность номеров документов.
-- Закрывает дефекты `Д-3`, `Д-4`, `Д-21`.
--
-- ПОРЯДОК РАБОТ (нарушать нельзя):
--   1. npm run report:document-numbers  — dry-run, только читает;
--   2. npm run fix:document-numbers     — чинит, «до» пишет в DocumentNumberingBackup;
--   3. эта миграция.
--
-- Миграция САМА проверяет всё, что проверяет отчёт, и падает внятным текстом.
-- Иначе ошибка вылезла бы как «duplicate key value violates unique constraint»
-- посреди выкладки — в момент, когда откатывать дороже всего.

-- ---------------------------------------------------------------------------
-- Шаг 1. Компания у КАЖДОГО документа.
-- ---------------------------------------------------------------------------
-- До этапа 6 `companyId` заполнялся только у документов без заказа: инвариант
-- `Document_order_xor_company` требовал «либо заказ, либо компания». Но
-- уникальность номера требование просит именно ПО КОМПАНИИ, а у документа
-- заказа она лежит в другой таблице — индекс по ней физически не построить.
--
-- Поэтому XOR заменяется на более сильное правило: компания есть ВСЕГДА, а у
-- документа заказа она обязана совпадать с компанией заказа. Второе теперь
-- держит составной внешний ключ, а не комментарий.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM "Document" d
    JOIN "Order" o ON o."id" = d."orderId"
   WHERE d."companyId" IS NULL AND o."companyId" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'Документы заказов без компании: % шт. Подставить её неоткуда — проставьте компанию этим заказам вручную. Подробности: npm run report:document-numbers',
      bad;
  END IF;
END $$;

UPDATE "Document" d
   SET "companyId" = o."companyId"
  FROM "Order" o
 WHERE o."id" = d."orderId"
   AND d."companyId" IS NULL;

DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM "Document" WHERE "companyId" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'После заполнения осталось % документов без компании — миграция отменена.', bad;
  END IF;
END $$;

ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_order_xor_company";
ALTER TABLE "Document" ALTER COLUMN "companyId" SET NOT NULL;

-- Составной ключ на заказ: компания документа не может разойтись с компанией
-- его заказа. Для этого заказу нужен уникальный ключ (id, companyId) — он
-- избыточен по данным, но обязателен для ссылки.
ALTER TABLE "Order" ADD CONSTRAINT "Order_id_companyId_key" UNIQUE ("id", "companyId");
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_order_company_fkey"
  FOREIGN KEY ("orderId", "companyId") REFERENCES "Order"("id", "companyId")
  ON UPDATE CASCADE ON DELETE NO ACTION;

-- ---------------------------------------------------------------------------
-- Шаг 2. Ссылка на заменённый документ становится настоящей связью (`Д-3`).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM "Document" d
   WHERE d."replacesDocumentId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Document" x WHERE x."id" = d."replacesDocumentId");
  IF bad > 0 THEN
    RAISE EXCEPTION
      'Ссылок на несуществующий заменённый документ: % шт. Запустите npm run fix:document-numbers.',
      bad;
  END IF;
END $$;

CREATE INDEX "Document_replacesDocumentId_idx" ON "Document"("replacesDocumentId");
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_replacesDocumentId_fkey"
  FOREIGN KEY ("replacesDocumentId") REFERENCES "Document"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Шаг 3. Счётчик номеров привязывается к компании (`Д-21`).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM "DocumentCounter" dc
   WHERE NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = dc."companyId");
  IF bad > 0 THEN
    RAISE EXCEPTION
      'Счётчиков номеров без компании: % шт. Запустите npm run fix:document-numbers.',
      bad;
  END IF;
END $$;

ALTER TABLE "DocumentCounter"
  ADD CONSTRAINT "DocumentCounter_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Шаг 4. Уникальность номера (`Д-4`).
-- ---------------------------------------------------------------------------
-- Индекс ЧАСТИЧНЫЙ (`WHERE "number" IS NOT NULL`) намеренно: документы из 1С и
-- загруженные вручную номера не имеют, а в Postgres два NULL не равны — без
-- условия индекс всё равно их не ограничивал бы, зато следующий читатель решил
-- бы, что защита шире, чем она есть. `NULLS NOT DISTINCT` тут противопоказан:
-- он запретил бы второй безномерный документ той же пары, то есть сломал бы
-- обычную загрузку файлов.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1
      FROM "Document"
     WHERE "number" IS NOT NULL
     GROUP BY "companyId", "type", "number", "version"
    HAVING count(*) > 1
  ) g;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'Групп документов с одинаковым номером и версией: % шт. Запустите npm run fix:document-numbers — он разведёт их версиями, номера не трогая.',
      bad;
  END IF;
END $$;

CREATE UNIQUE INDEX "Document_companyId_type_number_version_key"
    ON "Document"("companyId", "type", "number", "version")
 WHERE "number" IS NOT NULL;

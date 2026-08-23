-- Этап 1 ТЗ 2026-08-21 (`У-83`/`У-84`): ключ контрагента у строк очереди
-- разбора и ключ названия у организаций — фундамент дедупликации и точного
-- сопоставления без ИНН. Колонки + индексы + бэкфилл существующих строк.
--
-- Бэкфилл повторяет алгоритм counterparty-key.ts ДОСЛОВНО и в том же
-- порядке шагов: upper → ё→е → пунктуация→пробел → схлопнуть/обрезать →
-- вырезать орг-форму токеном (^|\s)ФОРМА(?=\s|$) → схлопнуть/обрезать →
-- пустой остаток = NULL. Паритет SQL ≡ TS держит тест
-- import.card51.counterparty-key.sql-parity: он исполняет функцию,
-- извлечённую из ЭТОГО файла (маркеры ниже), и сравнивает с TS-функцией —
-- копии алгоритма в тесте нет. pg_temp-функция живёт только в соединении
-- миграции (Prisma гонит её одной транзакцией) и исчезает сама.

ALTER TABLE "PaymentImportRow" ADD COLUMN "counterpartyKey" TEXT;
ALTER TABLE "PaymentImportRow" ADD COLUMN "counterpartyInnSource" TEXT;
ALTER TABLE "Organization" ADD COLUMN "nameKey" TEXT;

CREATE INDEX "PaymentImportRow_counterpartyKey_idx" ON "PaymentImportRow"("counterpartyKey");
CREATE INDEX "Organization_companyId_nameKey_idx" ON "Organization"("companyId", "nameKey");

-- counterparty-key-fn-begin
CREATE FUNCTION pg_temp.counterparty_key(src text) RETURNS text AS $fn$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(
          btrim(
            regexp_replace(
              regexp_replace(replace(upper(src), 'Ё', 'Е'), '[«»"''`().,;:!?/\\-]', ' ', 'g'),
              '\s+', ' ', 'g'
            )
          ),
          '(^|\s)(ООО|АО|ПАО|ЗАО|ОАО|ИП|НКО|АНО|ГБУ|МБУ|ФГУП|МУП)(?=\s|$)', '\1', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  )
$fn$ LANGUAGE sql IMMUTABLE;
-- counterparty-key-fn-end

UPDATE "PaymentImportRow"
SET "counterpartyKey" = pg_temp.counterparty_key("counterpartyName")
WHERE "counterpartyName" IS NOT NULL;

UPDATE "Organization"
SET "nameKey" = pg_temp.counterparty_key("name");

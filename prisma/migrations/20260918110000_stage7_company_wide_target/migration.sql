-- Этап 7 «Отчёты и KPI», `У-242` (вопрос `В-7-2`): план на компанию целиком.
--
-- У показателей без ответственного (удостоверения) менеджера нет вовсе —
-- приписать их человеку значило бы врать в отчёте. Такой план хранится строкой
-- с пустым `managerId`.
--
-- Postgres считает NULL-ы различными, поэтому обычный уникальный индекс двух
-- таких строк не удержит: нужен ЧАСТИЧНЫЙ уникальный индекс на случай NULL.

ALTER TABLE "SalesTarget" ALTER COLUMN "managerId" DROP NOT NULL;

CREATE UNIQUE INDEX "SalesTarget_company_period_metric_key"
  ON "SalesTarget" ("companyId", "year", "month", "metric")
  WHERE "managerId" IS NULL;

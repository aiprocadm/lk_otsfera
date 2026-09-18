-- Этап 7 «Отчёты и KPI», `У-242`: план становится планом ПО ПОКАЗАТЕЛЮ.
-- Миграция аддитивна и обратима: прежние строки получают `revenue_paid`
-- и продолжают работать как план продаж в рублях.

ALTER TABLE "Company" ADD COLUMN "activeKpiMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "SalesTarget" ADD COLUMN "metric" TEXT NOT NULL DEFAULT 'revenue_paid';

-- Прежняя уникальность не различала показатели: второй план на тот же месяц
-- для того же менеджера просто не поместился бы в таблицу.
DROP INDEX IF EXISTS "SalesTarget_companyId_managerId_year_month_key";
CREATE UNIQUE INDEX "SalesTarget_companyId_managerId_year_month_metric_key"
  ON "SalesTarget" ("companyId", "managerId", "year", "month", "metric");

DROP INDEX IF EXISTS "SalesTarget_companyId_year_month_idx";
CREATE INDEX "SalesTarget_companyId_year_month_metric_idx"
  ON "SalesTarget" ("companyId", "year", "month", "metric");


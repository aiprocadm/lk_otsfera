-- Этап 6 PR-4 (У-236): «участники видят только свои заказы» — правило организации.
-- Аддитивно и обратимо: одна колонка со значением по умолчанию «как раньше».
ALTER TABLE "Organization" ADD COLUMN "membersSeeOwnOrdersOnly" BOOLEAN NOT NULL DEFAULT false;

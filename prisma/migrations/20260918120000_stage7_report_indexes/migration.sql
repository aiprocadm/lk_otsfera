-- Этап 7 «Отчёты и KPI», `У-248`: индексы под отчёты за период.
--
-- Отчёты и показатели фильтруют «компания + диапазон дат». Пары с датой у
-- заказа не было вовсе: был голый `closedAt` по всем компаниям сразу, поэтому
-- месячный отчёт читал таблицу целиком.
--
-- `CONCURRENTLY` не используем: миграции идут в транзакции, а таблица заказов
-- на проде невелика — блокировка на время построения приемлема.

CREATE INDEX "Order_companyId_createdAt_idx" ON "Order" ("companyId", "createdAt");
CREATE INDEX "Order_companyId_completedAt_idx" ON "Order" ("companyId", "completedAt");
CREATE INDEX "Order_companyId_closedAt_idx" ON "Order" ("companyId", "closedAt");
CREATE INDEX "Order_companyId_deadline_idx" ON "Order" ("companyId", "deadline");

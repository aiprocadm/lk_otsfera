-- Этап 2 ТЗ v0.5 (§10): настраиваемый справочник рабочих статусов заявки.
-- Решения заказчика: вариант A (справочник вместо главного статуса), общий на
-- систему, executionStatus остаётся в базе, отмена менеджером — с причиной.

-- CreateTable
CREATE TABLE "OrderStatusDefinition" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "anchor" TEXT,

    CONSTRAINT "OrderStatusDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusChange" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,
    "fromId" TEXT,
    "toId" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,

    CONSTRAINT "OrderStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderStatusDefinition_companyId_key_key" ON "OrderStatusDefinition"("companyId", "key");
CREATE INDEX "OrderStatusDefinition_companyId_isActive_sortOrder_idx" ON "OrderStatusDefinition"("companyId", "isActive", "sortOrder");
CREATE INDEX "OrderStatusChange_orderId_createdAt_idx" ON "OrderStatusChange"("orderId", "createdAt");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "statusId" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "OrderStatusDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "OrderStatusDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_toId_fkey" FOREIGN KEY ("toId") REFERENCES "OrderStatusDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Сид семёрки §10. Ключи неизменяемы, названия заказчик правит сам.
-- Якорь связывает строку с производным фактом (оплата, выдача документов,
-- подпись бухгалтерии, закрытие) — переименовать можно, оторвать нельзя.
INSERT INTO "OrderStatusDefinition"
  ("id", "updatedAt", "companyId", "key", "label", "sortOrder", "isActive", "isSystem", "isTerminal", "anchor")
VALUES
  ('oss_draft',     CURRENT_TIMESTAMP, NULL, 'draft',             'Черновик заявки',      1, true, true, false, NULL),
  ('oss_accepted',  CURRENT_TIMESTAMP, NULL, 'accepted',          'Принято в работу',     2, true, true, false, NULL),
  ('oss_paid',      CURRENT_TIMESTAMP, NULL, 'paid',              'Оплата поступила',     3, true, true, false, 'paid'),
  ('oss_docs',      CURRENT_TIMESTAMP, NULL, 'documents_issued',  'Документы выданы',     4, true, true, false, 'documents_issued'),
  ('oss_signed',    CURRENT_TIMESTAMP, NULL, 'accounting_signed', 'Бухгалтерия подписана',5, true, true, false, 'accounting_signed'),
  ('oss_closed',    CURRENT_TIMESTAMP, NULL, 'closed',            'Заявка закрыта',       6, true, true, false, 'closed'),
  ('oss_cancelled', CURRENT_TIMESTAMP, NULL, 'cancelled',         'Отменена',             7, true, true, true,  NULL);

-- Перенос существующих заявок. Карта из спеки §3 (вариант A):
--   new            → Черновик заявки
--   in_progress    → Принято в работу
--   waiting_client → Принято в работу (причина возврата уже хранится отдельно)
--   completed      → Заявка закрыта
-- Ни одна заявка не должна остаться без статуса — проверяется регрессом
-- services.orderStatuses.migration.integration.
UPDATE "Order" SET "statusId" = CASE "status"
  WHEN 'new'            THEN 'oss_draft'
  WHEN 'in_progress'    THEN 'oss_accepted'
  WHEN 'waiting_client' THEN 'oss_accepted'
  WHEN 'completed'      THEN 'oss_closed'
END
WHERE "statusId" IS NULL;

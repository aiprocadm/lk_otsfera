-- Этап 2 PR-4 (§10): снятие старого поля рабочего статуса.
--
-- Перед удалением проверено, что колонку никто не читает: обмен с 1С смотрит на
-- собственный журнал синхронизации, выгрузки и уведомления — на
-- `executionStatus`, интерфейс — на справочник (`statusId`). Единственный
-- читатель, `transitionOrderLifecycle`, удалён в этом же PR.
--
-- Страховка от потери данных: заявки без `statusId` (если такие остались)
-- добираются здесь ещё раз, ДО удаления колонки.
UPDATE "Order" o
SET "statusId" = d.id
FROM "OrderStatusDefinition" d
WHERE o."statusId" IS NULL
  AND d."companyId" IS NULL
  AND d."key" = CASE o."status"
    WHEN 'new'            THEN 'draft'
    WHEN 'in_progress'    THEN 'accepted'
    WHEN 'waiting_client' THEN 'accepted'
    WHEN 'completed'      THEN 'closed'
  END;

ALTER TABLE "Order" DROP COLUMN "status";

DROP TYPE "OrderStatus";

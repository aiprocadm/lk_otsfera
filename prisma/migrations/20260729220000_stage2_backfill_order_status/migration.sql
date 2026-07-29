-- Этап 2 PR-3: добор заявок, созданных между PR-1 и PR-3.
-- PR-1 перевёл существующие заявки, но новые создавались без statusId, пока
-- места создания не знали про справочник. Карта — та же, что в PR-1
-- (LEGACY_STATUS_TO_KEY): исходник карты живёт в коде, здесь её повторение.
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

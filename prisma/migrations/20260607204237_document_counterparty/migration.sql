-- CounterpartyType enum
CREATE TYPE "CounterpartyType" AS ENUM ('organization', 'partner');

-- Add columns nullable first (existing rows have no value yet)
ALTER TABLE "Document" ADD COLUMN "counterpartyType" "CounterpartyType";
ALTER TABLE "Document" ADD COLUMN "counterpartyId" TEXT;

-- Backfill: default to the order's organization channel...
UPDATE "Document" d
SET "counterpartyType" = 'organization', "counterpartyId" = o."organizationId"
FROM "Order" o
WHERE d."orderId" = o."id";

-- ...except commission statements, which belong to the partner channel
-- (only when the order actually has a partner).
UPDATE "Document" d
SET "counterpartyType" = 'partner', "counterpartyId" = o."partnerId"
FROM "Order" o
WHERE d."orderId" = o."id"
  AND d."type" = 'commission_statement'
  AND o."partnerId" IS NOT NULL;

-- Enforce NOT NULL now that every row is populated
ALTER TABLE "Document" ALTER COLUMN "counterpartyType" SET NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "counterpartyId" SET NOT NULL;

-- Channel index
CREATE INDEX "Document_counterpartyType_counterpartyId_idx"
  ON "Document"("counterpartyType", "counterpartyId");

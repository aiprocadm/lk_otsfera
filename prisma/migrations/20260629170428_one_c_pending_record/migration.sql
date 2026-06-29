-- DropForeignKey
ALTER TABLE "CommissionStatementItem" DROP CONSTRAINT "CommissionStatementItem_orderId_fkey";

-- CreateTable
CREATE TABLE "OneCPendingRecord" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "dto" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTriedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneCPendingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OneCPendingRecord_status_entity_idx" ON "OneCPendingRecord"("status", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "OneCPendingRecord_entity_externalId_key" ON "OneCPendingRecord"("entity", "externalId");

-- AddForeignKey
ALTER TABLE "CommissionStatementItem" ADD CONSTRAINT "CommissionStatementItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

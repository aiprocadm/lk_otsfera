-- F4 (§16, A5): append-only история индивидуальной ставки организации, по
-- образцу CommissionRateChange. newRate NULL = событие «очистка override».
-- Reversible: new empty table only, no data change (rollback = DROP TABLE).

-- CreateTable
CREATE TABLE "OrganizationCommissionRateChange" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "oldRate" DECIMAL(6,4),
    "newRate" DECIMAL(6,4),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,

    CONSTRAINT "OrganizationCommissionRateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgCommissionRateChange_organizationId_effectiveFrom_idx" ON "OrganizationCommissionRateChange"("organizationId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "OrganizationCommissionRateChange" ADD CONSTRAINT "OrganizationCommissionRateChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

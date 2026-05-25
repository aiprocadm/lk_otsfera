-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "Order_organizationId_executionStatus_idx" ON "Order"("organizationId", "executionStatus");

-- CreateIndex
CREATE INDEX "Order_organizationId_financialStatus_idx" ON "Order"("organizationId", "financialStatus");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Lead — add nullable externalIdInOneC for outbound pushLead tracking
ALTER TABLE "Lead" ADD COLUMN "externalIdInOneC" TEXT;

-- AlterTable: LeadAttachment — add nullable createdByUserId for delete RBAC
ALTER TABLE "LeadAttachment" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "LeadAttachment_createdByUserId_idx" ON "LeadAttachment"("createdByUserId");

-- AddForeignKey
ALTER TABLE "LeadAttachment" ADD CONSTRAINT "LeadAttachment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

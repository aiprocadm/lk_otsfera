-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('open', 'won', 'lost');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'promoted_to_deal';

-- AlterTable
ALTER TABLE "DealNote" ADD COLUMN     "dealId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "promotedDealId" TEXT;

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT,
    "organizationId" TEXT,
    "contactId" TEXT,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "managerId" TEXT,
    "status" "DealStatus" NOT NULL DEFAULT 'open',
    "stageId" TEXT,
    "expectedCloseAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "orderId" TEXT,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealStage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "statusAnchor" "DealStatus" NOT NULL,
    "color" TEXT,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DealStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_leadId_key" ON "Deal"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_orderId_key" ON "Deal"("orderId");

-- CreateIndex
CREATE INDEX "Deal_companyId_status_idx" ON "Deal"("companyId", "status");

-- CreateIndex
CREATE INDEX "Deal_managerId_idx" ON "Deal"("managerId");

-- CreateIndex
CREATE INDEX "Deal_stageId_idx" ON "Deal"("stageId");

-- CreateIndex
CREATE INDEX "DealStage_companyId_idx" ON "DealStage"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DealStage_companyId_position_key" ON "DealStage"("companyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_promotedDealId_key" ON "Lead"("promotedDealId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "DealStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStage" ADD CONSTRAINT "DealStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;


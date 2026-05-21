-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'on_hold');

-- CreateEnum
CREATE TYPE "FinancialStatus" AS ENUM ('not_billed', 'billed', 'partially_paid', 'paid', 'refunded');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('contract', 'extra_agreement', 'invoice', 'act', 'waybill', 'certificate', 'report', 'commission_statement', 'other');

-- CreateEnum
CREATE TYPE "DocumentDirection" AS ENUM ('incoming', 'outgoing');

-- CreateEnum
CREATE TYPE "GenerationSource" AS ENUM ('user', 'system');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('lead_status_changed', 'order_status_changed', 'payment_received', 'document_uploaded', 'commission_statement_ready', 'mention_in_comment', 'partner_assignment_changed', 'sync_error');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'in_review', 'qualified', 'promoted_to_order', 'rejected');

-- CreateEnum
CREATE TYPE "CommissionStatementStatus" AS ENUM ('draft', 'approved', 'paid', 'superseded');

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_uploadedById_fkey";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "direction" "DocumentDirection" NOT NULL DEFAULT 'incoming',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "generatedBy" "GenerationSource" NOT NULL DEFAULT 'user',
ADD COLUMN     "replacesDocumentId" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "size" INTEGER,
ADD COLUMN     "type" "DocumentType" NOT NULL DEFAULT 'other',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "uploadedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "contractSignedAt" TIMESTAMP(3),
ADD COLUMN     "executionStatus" "ExecutionStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "financialStatus" "FinancialStatus" NOT NULL DEFAULT 'not_billed',
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "partnerId" TEXT,
ADD COLUMN     "productMix" TEXT[],
ADD COLUMN     "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "vatRate" DECIMAL(5,4);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "assignedManagerUserId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "inn" TEXT,
ADD COLUMN     "kpp" TEXT,
ADD COLUMN     "partnerCommissionRate" DECIMAL(6,4),
ADD COLUMN     "partnerCommissionRateChangedAt" TIMESTAMP(3),
ADD COLUMN     "partnerCommissionRateChangedBy" TEXT,
ADD COLUMN     "partnerCommissionRateNote" TEXT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "commissionRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "PartnerUser" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleInPartner" TEXT NOT NULL DEFAULT 'manager',
    "assignedOrgIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PartnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "partnerId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "clientCompanyName" TEXT NOT NULL,
    "clientInn" TEXT,
    "clientContactName" TEXT NOT NULL,
    "clientContactPhone" TEXT,
    "clientContactEmail" TEXT,
    "subject" TEXT NOT NULL,
    "estimatedAmount" DECIMAL(14,2),
    "productType" TEXT[],
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "assignedManagerId" TEXT,
    "promotedOrderId" TEXT,
    "rejectedReason" TEXT,
    "notes" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAttachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "LeadAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionStatement" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "partnerId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedByUserId" TEXT,
    "totalBaseAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "averageRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "totalCommissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "CommissionStatementStatus" NOT NULL DEFAULT 'draft',
    "pdfPath" TEXT,
    "xlsxPath" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "supersededBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "CommissionStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionStatementItem" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "organizationName" TEXT NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CommissionStatementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,
    "externalId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entity" TEXT NOT NULL,
    "externalId" TEXT,
    "direction" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "payload" JSONB,
    "durationMs" INTEGER,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerUser_partnerId_isActive_idx" ON "PartnerUser"("partnerId", "isActive");

-- CreateIndex
CREATE INDEX "PartnerUser_userId_idx" ON "PartnerUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_partnerId_userId_key" ON "PartnerUser"("partnerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_promotedOrderId_key" ON "Lead"("promotedOrderId");

-- CreateIndex
CREATE INDEX "Lead_partnerId_status_idx" ON "Lead"("partnerId", "status");

-- CreateIndex
CREATE INDEX "Lead_assignedManagerId_idx" ON "Lead"("assignedManagerId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "LeadAttachment_leadId_idx" ON "LeadAttachment"("leadId");

-- CreateIndex
CREATE INDEX "CommissionStatement_partnerId_periodFrom_periodTo_idx" ON "CommissionStatement"("partnerId", "periodFrom", "periodTo");

-- CreateIndex
CREATE INDEX "CommissionStatement_status_idx" ON "CommissionStatement"("status");

-- CreateIndex
CREATE INDEX "CommissionStatementItem_statementId_idx" ON "CommissionStatementItem"("statementId");

-- CreateIndex
CREATE INDEX "CommissionStatementItem_orderId_idx" ON "CommissionStatementItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_externalId_idx" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "SavedView_userId_scope_idx" ON "SavedView"("userId", "scope");

-- CreateIndex
CREATE INDEX "SyncLog_entity_createdAt_idx" ON "SyncLog"("entity", "createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_status_createdAt_idx" ON "SyncLog"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_externalId_key" ON "Document"("externalId");

-- CreateIndex
CREATE INDEX "Document_orderId_type_idx" ON "Document"("orderId", "type");

-- CreateIndex
CREATE INDEX "Document_type_createdAt_idx" ON "Document"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Document_externalId_idx" ON "Document"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_externalId_key" ON "Order"("externalId");

-- CreateIndex
CREATE INDEX "Order_partnerId_executionStatus_idx" ON "Order"("partnerId", "executionStatus");

-- CreateIndex
CREATE INDEX "Order_partnerId_financialStatus_idx" ON "Order"("partnerId", "financialStatus");

-- CreateIndex
CREATE INDEX "Order_externalId_idx" ON "Order"("externalId");

-- CreateIndex
CREATE INDEX "Order_closedAt_idx" ON "Order"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_externalId_key" ON "Organization"("externalId");

-- CreateIndex
CREATE INDEX "Organization_partnerId_idx" ON "Organization"("partnerId");

-- CreateIndex
CREATE INDEX "Organization_externalId_idx" ON "Organization"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_slug_key" ON "Partner"("slug");

-- AddForeignKey
ALTER TABLE "PartnerUser" ADD CONSTRAINT "PartnerUser_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerUser" ADD CONSTRAINT "PartnerUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_promotedOrderId_fkey" FOREIGN KEY ("promotedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttachment" ADD CONSTRAINT "LeadAttachment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionStatement" ADD CONSTRAINT "CommissionStatement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionStatement" ADD CONSTRAINT "CommissionStatement_calculatedByUserId_fkey" FOREIGN KEY ("calculatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionStatementItem" ADD CONSTRAINT "CommissionStatementItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CommissionStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionStatementItem" ADD CONSTRAINT "CommissionStatementItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


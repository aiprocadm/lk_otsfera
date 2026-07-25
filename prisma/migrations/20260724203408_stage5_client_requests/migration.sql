-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('partner_legacy', 'client_request', 'manual', 'website');

-- CreateEnum
CREATE TYPE "ClientRequestSource" AS ENUM ('partner_cabinet', 'organization_cabinet', 'website');

-- CreateEnum
CREATE TYPE "ClientRequestStatus" AS ENUM ('submitted', 'in_triage', 'converted', 'rejected');

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_partnerId_fkey";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "source" "LeadSource" NOT NULL DEFAULT 'partner_legacy',
ADD COLUMN     "sourceRequestId" TEXT,
ALTER COLUMN "partnerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ClientRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" "ClientRequestSource" NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "partnerId" TEXT,
    "organizationId" TEXT,
    "companyName" TEXT NOT NULL,
    "inn" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "status" "ClientRequestStatus" NOT NULL DEFAULT 'submitted',
    "triagedByUserId" TEXT,
    "triagedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRequestAttachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "scanReason" TEXT,
    "scannedAt" TIMESTAMP(3),

    CONSTRAINT "ClientRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientRequest_status_idx" ON "ClientRequest"("status");

-- CreateIndex
CREATE INDEX "ClientRequest_partnerId_idx" ON "ClientRequest"("partnerId");

-- CreateIndex
CREATE INDEX "ClientRequest_organizationId_idx" ON "ClientRequest"("organizationId");

-- CreateIndex
CREATE INDEX "ClientRequest_submittedByUserId_idx" ON "ClientRequest"("submittedByUserId");

-- CreateIndex
CREATE INDEX "ClientRequest_createdAt_idx" ON "ClientRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ClientRequestAttachment_requestId_idx" ON "ClientRequestAttachment"("requestId");

-- CreateIndex
CREATE INDEX "ClientRequestAttachment_scanStatus_idx" ON "ClientRequestAttachment"("scanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sourceRequestId_key" ON "Lead"("sourceRequestId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceRequestId_fkey" FOREIGN KEY ("sourceRequestId") REFERENCES "ClientRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_triagedByUserId_fkey" FOREIGN KEY ("triagedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequestAttachment" ADD CONSTRAINT "ClientRequestAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequestAttachment" ADD CONSTRAINT "ClientRequestAttachment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable: Document — add async-scan tracking columns
ALTER TABLE "Document" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Document" ADD COLUMN "scanReason" TEXT;
ALTER TABLE "Document" ADD COLUMN "scannedAt" TIMESTAMP(3);

-- AlterTable: LeadAttachment — same scan tracking
ALTER TABLE "LeadAttachment" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "LeadAttachment" ADD COLUMN "scanReason" TEXT;
ALTER TABLE "LeadAttachment" ADD COLUMN "scannedAt" TIMESTAMP(3);

-- CreateIndex: speed up backfill query and admin "infected only" filters
CREATE INDEX "Document_scanStatus_idx" ON "Document"("scanStatus");
CREATE INDEX "LeadAttachment_scanStatus_idx" ON "LeadAttachment"("scanStatus");

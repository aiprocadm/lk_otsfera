/*
  Warnings:

  - A unique constraint covering the columns `[sourceCallId]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sourceInboundId]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSource" ADD VALUE 'call';
ALTER TYPE "LeadSource" ADD VALUE 'inbound_message';

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedByUserId" TEXT,
ADD COLUMN     "intakeClosedAt" TIMESTAMP(3),
ADD COLUMN     "intakeClosedById" TEXT;

-- AlterTable
ALTER TABLE "EnrollmentRequest" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedByUserId" TEXT;

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "sourceCallId" TEXT,
ADD COLUMN     "sourceInboundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sourceCallId_key" ON "Lead"("sourceCallId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sourceInboundId_key" ON "Lead"("sourceInboundId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceCallId_fkey" FOREIGN KEY ("sourceCallId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceInboundId_fkey" FOREIGN KEY ("sourceInboundId") REFERENCES "InboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

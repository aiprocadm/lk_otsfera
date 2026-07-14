-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "initiatedByUserId" TEXT;

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DealNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "DealNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealNote_orderId_createdAt_idx" ON "DealNote"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "DealNote_authorId_idx" ON "DealNote"("authorId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

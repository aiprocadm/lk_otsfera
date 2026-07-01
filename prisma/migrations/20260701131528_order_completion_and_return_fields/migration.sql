-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accountingSignedAt" TIMESTAMP(3),
ADD COLUMN     "returnReason" TEXT;

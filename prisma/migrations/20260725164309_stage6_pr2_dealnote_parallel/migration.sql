-- DropForeignKey
ALTER TABLE "DealNote" DROP CONSTRAINT "DealNote_orderId_fkey";

-- AlterTable
ALTER TABLE "DealNote" ALTER COLUMN "orderId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;


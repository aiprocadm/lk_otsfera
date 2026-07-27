-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliverablesApprovedAt" TIMESTAMP(3),
ADD COLUMN     "deliverablesApprovedById" TEXT,
ADD COLUMN     "resultDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "resultDeliveredById" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliverablesApprovedById_fkey" FOREIGN KEY ("deliverablesApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_resultDeliveredById_fkey" FOREIGN KEY ("resultDeliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

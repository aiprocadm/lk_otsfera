-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "totalAmountIsManual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "title" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "CatalogUnit" NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "vatRate" DECIMAL(5,4),
    "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLine_orderId_sortOrder_idx" ON "OrderLine"("orderId", "sortOrder");

-- CreateIndex
CREATE INDEX "OrderLine_catalogItemId_idx" ON "OrderLine"("catalogItemId");

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


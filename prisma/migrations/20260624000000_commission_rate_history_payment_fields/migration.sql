-- §9.1 история ставок комиссии + §7.1 поля оплаты (gap #4). Аддитивно, всё nullable.

-- AlterTable: §7.1 поля оплаты
ALTER TABLE "Payment" ADD COLUMN     "enteredById" TEXT,
ADD COLUMN     "paymentOrderNumber" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "vatAmount" DECIMAL(14,2);

-- CreateTable: §9.1 история ставок комиссии
CREATE TABLE "CommissionRateChange" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partnerId" TEXT NOT NULL,
    "oldRate" DECIMAL(6,4),
    "newRate" DECIMAL(6,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,

    CONSTRAINT "CommissionRateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRateChange_partnerId_effectiveFrom_idx" ON "CommissionRateChange"("partnerId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRateChange" ADD CONSTRAINT "CommissionRateChange_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

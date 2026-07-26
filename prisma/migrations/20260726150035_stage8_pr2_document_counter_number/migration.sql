-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "amount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("companyId","year")
);

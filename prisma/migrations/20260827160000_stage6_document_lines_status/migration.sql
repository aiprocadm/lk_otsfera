-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('draft', 'issued', 'sent', 'accepted', 'rejected', 'expired', 'cancelled');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedByUserId" TEXT,
ADD COLUMN     "amountGross" DECIMAL(14,2),
ADD COLUMN     "amountNet" DECIMAL(14,2),
ADD COLUMN     "amountVat" DECIMAL(14,2),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "parentDocumentId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentById" TEXT,
ADD COLUMN     "status" "DocumentStatus" NOT NULL DEFAULT 'issued',
ADD COLUMN     "templateVersion" INTEGER;

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "CatalogUnit" NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "vatRate" DECIMAL(5,4),
    "vatAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentLine_documentId_sortOrder_idx" ON "DocumentLine"("documentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_parentDocumentId_idx" ON "Document"("parentDocumentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Этап 6 (`У-148`): существующие документы получают `issued` по умолчанию
-- колонки, а подписанные — `accepted`. Строк и итогов старым документам НЕ
-- выдаём: `У-146` прямо запрещает бэкфилл сумм задним числом (он выдумал бы
-- цифры, которых в документе никогда не было).
UPDATE "Document" SET "status" = 'accepted' WHERE "signedAt" IS NOT NULL;

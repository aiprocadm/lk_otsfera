-- CreateEnum
CREATE TYPE "CompanyBrandingSlot" AS ENUM ('logo', 'signature', 'stamp');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultVatRate" DECIMAL(5,4),
ADD COLUMN     "documentNumbering" JSONB,
ADD COLUMN     "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CompanyBrandingAsset" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "slot" "CompanyBrandingSlot" NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "scanReason" TEXT,
    "scannedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyBrandingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBrandingAsset_companyId_slot_key" ON "CompanyBrandingAsset"("companyId", "slot");

-- AddForeignKey
ALTER TABLE "CompanyBrandingAsset" ADD CONSTRAINT "CompanyBrandingAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


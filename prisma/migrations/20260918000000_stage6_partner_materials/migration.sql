-- Этап 6 PR-3 (У-237): материалы для партнёров — материал компании и версии его файла.
-- Аддитивно и обратимо: новый enum и две новые таблицы.
CREATE TYPE "PartnerMaterialCategory" AS ENUM ('price_list', 'presentation', 'template', 'instruction', 'other');

CREATE TABLE "PartnerMaterial" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "PartnerMaterialCategory" NOT NULL DEFAULT 'other',
    "externalUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "PartnerMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerMaterialFile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "materialId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "scanReason" TEXT,
    "scannedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "PartnerMaterialFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerMaterial_companyId_isActive_publishedAt_idx" ON "PartnerMaterial"("companyId", "isActive", "publishedAt");
CREATE INDEX "PartnerMaterialFile_materialId_supersededAt_idx" ON "PartnerMaterialFile"("materialId", "supersededAt");
CREATE INDEX "PartnerMaterialFile_scanStatus_idx" ON "PartnerMaterialFile"("scanStatus");

ALTER TABLE "PartnerMaterial" ADD CONSTRAINT "PartnerMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerMaterial" ADD CONSTRAINT "PartnerMaterial_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerMaterialFile" ADD CONSTRAINT "PartnerMaterialFile_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "PartnerMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerMaterialFile" ADD CONSTRAINT "PartnerMaterialFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

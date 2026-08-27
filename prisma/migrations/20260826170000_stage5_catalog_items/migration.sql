-- CreateEnum
CREATE TYPE "CatalogUnit" AS ENUM ('person', 'piece', 'service', 'hour', 'month');

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unit" "CatalogUnit" NOT NULL DEFAULT 'person',
    "price" DECIMAL(14,2) NOT NULL,
    "vatRate" DECIMAL(5,4),
    "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
    "directionId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItem_companyId_isActive_sortOrder_idx" ON "CatalogItem"("companyId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "CatalogItem_directionId_idx" ON "CatalogItem"("directionId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_companyId_code_key" ON "CatalogItem"("companyId", "code");

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "TrainingDirection"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-190`, решение `Р-Б-11`).
-- Спека — docs/superpowers/specs/2026-09-13-stage2-bitrix-migration-design.md §2.
--
-- Миграция аддитивная и обратимая: две новые таблицы (пакет миграции и его
-- журнал записей), шесть новых nullable-колонок `bitrixId` с уникальными
-- индексами (ключ строки в Битрикс24; портал на платформу один, поэтому
-- уникальность глобальная; `externalId` остаётся за 1С) и одно ослабление —
-- `DealNote.authorId` становится необязательным: заметка, перенесённая из
-- Битрикса, может быть без автора в ЛК (показывается как «Импорт из
-- Битрикс24»), как у `OrganizationNote`. Ни одна существующая строка не
-- меняется и не удаляется.
--
-- Обратный SQL: DROP TABLE "BitrixImportWrite"; DROP TABLE "BitrixImportBatch";
-- ALTER TABLE <шесть таблиц> DROP COLUMN "bitrixId"; у DealNote —
-- вернуть NOT NULL после проверки, что пустых авторов нет.
--
-- Составной ключ `Document_order_company_fkey` (миграция
-- 20260831160000_stage6_numbering_constraints) в схеме Prisma не выражен и
-- этой миграцией НЕ трогается.

-- DropForeignKey
ALTER TABLE "DealNote" DROP CONSTRAINT "DealNote_authorId_fkey";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "bitrixId" TEXT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "bitrixId" TEXT;

-- AlterTable
ALTER TABLE "DealNote" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "bitrixId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "bitrixId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bitrixId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "bitrixId" TEXT;

-- CreateTable
CREATE TABLE "BitrixImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'initial',
    "status" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "errors" JSONB,
    "reportPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "BitrixImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixImportWrite" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "bitrixId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BitrixImportWrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BitrixImportBatch_companyId_createdAt_idx" ON "BitrixImportBatch"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "BitrixImportBatch_status_idx" ON "BitrixImportBatch"("status");

-- CreateIndex
CREATE INDEX "BitrixImportWrite_batchId_entity_idx" ON "BitrixImportWrite"("batchId", "entity");

-- CreateIndex
CREATE INDEX "BitrixImportWrite_entity_entityId_idx" ON "BitrixImportWrite"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_bitrixId_key" ON "Contact"("bitrixId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_bitrixId_key" ON "Deal"("bitrixId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_bitrixId_key" ON "Document"("bitrixId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_bitrixId_key" ON "Lead"("bitrixId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_bitrixId_key" ON "Organization"("bitrixId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_bitrixId_key" ON "Task"("bitrixId");

-- AddForeignKey
ALTER TABLE "DealNote" ADD CONSTRAINT "DealNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixImportBatch" ADD CONSTRAINT "BitrixImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixImportWrite" ADD CONSTRAINT "BitrixImportWrite_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BitrixImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


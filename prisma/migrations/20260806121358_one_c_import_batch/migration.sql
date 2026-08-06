-- CreateTable
CREATE TABLE "OneCImportBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,
    "companyId" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackById" TEXT,

    CONSTRAINT "OneCImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneCImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "reverted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OneCImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OneCImportBatch_companyId_createdAt_idx" ON "OneCImportBatch"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "OneCImportRow_batchId_entity_idx" ON "OneCImportRow"("batchId", "entity");

-- CreateIndex
CREATE INDEX "OneCImportRow_entityId_idx" ON "OneCImportRow"("entityId");

-- AddForeignKey
ALTER TABLE "OneCImportBatch" ADD CONSTRAINT "OneCImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneCImportRow" ADD CONSTRAINT "OneCImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OneCImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

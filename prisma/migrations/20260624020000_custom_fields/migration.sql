-- §11: настраиваемые поля. Две новые таблицы + enum. Аддитивно.

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('text', 'number', 'date', 'select', 'boolean');

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "entityType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "definitionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_entityType_isActive_sortOrder_idx" ON "CustomFieldDefinition"("entityType", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_entityType_key_key" ON "CustomFieldDefinition"("entityType", "key");

-- CreateIndex
CREATE INDEX "CustomFieldValue_entityType_entityId_idx" ON "CustomFieldValue"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_definitionId_entityId_key" ON "CustomFieldValue"("definitionId", "entityId");

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

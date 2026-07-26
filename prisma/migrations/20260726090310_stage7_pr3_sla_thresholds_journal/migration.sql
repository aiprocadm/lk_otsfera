-- CreateTable
CREATE TABLE "SlaEscalation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "SlaEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlaEscalation_createdAt_idx" ON "SlaEscalation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlaEscalation_sourceType_sourceId_key" ON "SlaEscalation"("sourceType", "sourceId");

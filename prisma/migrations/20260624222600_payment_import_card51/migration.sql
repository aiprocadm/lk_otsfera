-- CreateTable
CREATE TABLE "PaymentImportBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,
    "companyId" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "PaymentImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentImportRow" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT,
    "paymentOrderNumber" TEXT,
    "vatAmount" DECIMAL(14,2),
    "counterpartyName" TEXT,
    "counterpartyInn" TEXT,
    "accountCandidates" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'needs_review',
    "candidateOrgId" TEXT,
    "candidateOrderId" TEXT,
    "matchMethod" TEXT,
    "rawRow" JSONB NOT NULL,
    "resolvedPaymentId" TEXT,

    CONSTRAINT "PaymentImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentImportBatch_companyId_createdAt_idx" ON "PaymentImportBatch"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentImportRow_externalId_key" ON "PaymentImportRow"("externalId");

-- CreateIndex
CREATE INDEX "PaymentImportRow_status_createdAt_idx" ON "PaymentImportRow"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentImportRow_batchId_idx" ON "PaymentImportRow"("batchId");

-- AddForeignKey
ALTER TABLE "PaymentImportBatch" ADD CONSTRAINT "PaymentImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentImportRow" ADD CONSTRAINT "PaymentImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

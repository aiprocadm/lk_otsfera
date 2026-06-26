CREATE TABLE "CommissionCorrection" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "partnerId" TEXT NOT NULL,
  "paymentId" TEXT,
  "originalStatementId" TEXT,
  "originalPeriodFrom" TIMESTAMP(3) NOT NULL,
  "originalPeriodTo" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "rate" DECIMAL(6,4) NOT NULL,
  "commissionAmount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "reason" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "parentCorrectionId" TEXT,
  "carriedReason" TEXT,
  "appliedInStatementId" TEXT,
  CONSTRAINT "CommissionCorrection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommissionCorrection_paymentId_key" ON "CommissionCorrection"("paymentId");
CREATE INDEX "CommissionCorrection_partnerId_status_idx" ON "CommissionCorrection"("partnerId", "status");
CREATE INDEX "CommissionCorrection_status_createdAt_idx" ON "CommissionCorrection"("status", "createdAt");
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommissionStatementItem" ADD COLUMN "correctionId" TEXT;
CREATE INDEX "CommissionStatementItem_correctionId_idx" ON "CommissionStatementItem"("correctionId");
ALTER TABLE "CommissionStatementItem" ADD CONSTRAINT "CommissionStatementItem_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "CommissionCorrection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

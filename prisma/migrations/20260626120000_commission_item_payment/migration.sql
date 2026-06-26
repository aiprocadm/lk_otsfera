-- CommissionStatementItem: orderId becomes nullable, add paymentId FK
ALTER TABLE "CommissionStatementItem" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "CommissionStatementItem" ADD COLUMN "paymentId" TEXT;

ALTER TABLE "CommissionStatementItem"
  ADD CONSTRAINT "CommissionStatementItem_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CommissionStatementItem_paymentId_idx" ON "CommissionStatementItem"("paymentId");

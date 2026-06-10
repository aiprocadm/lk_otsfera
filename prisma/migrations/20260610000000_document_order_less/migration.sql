-- orderId becomes optional (order-less documents)
ALTER TABLE "Document" ALTER COLUMN "orderId" DROP NOT NULL;

-- company anchor for order-less documents (NULL for order-bound docs)
ALTER TABLE "Document" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Document_companyId_idx" ON "Document"("companyId");

-- XOR invariant: a document is either order-bound (orderId set, companyId null)
-- or order-less (orderId null, companyId set) — never neither, never both.
-- Existing rows are all order-bound with companyId NULL, so they pass as-is.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_order_xor_company" CHECK (
    ("orderId" IS NOT NULL AND "companyId" IS NULL) OR
    ("orderId" IS NULL AND "companyId" IS NOT NULL)
  );

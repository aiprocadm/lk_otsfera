-- M3a: add columns nullable
ALTER TABLE "Payment" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Payment" ALTER COLUMN "orderId" DROP NOT NULL;

-- M4: backfill organizationId from the payment's order
UPDATE "Payment" p
SET "organizationId" = o."organizationId"
FROM "Order" o
WHERE p."orderId" = o."id" AND p."organizationId" IS NULL;

-- M3b: enforce NOT NULL after backfill
ALTER TABLE "Payment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- M1: Partner.inn unique
ALTER TABLE "Partner" ADD COLUMN "inn" TEXT;
CREATE UNIQUE INDEX "Partner_inn_key" ON "Partner"("inn");

-- M2: Organization.partnerId nullable
ALTER TABLE "Organization" ALTER COLUMN "partnerId" DROP NOT NULL;

-- M5: Organization.inn unique
CREATE UNIQUE INDEX "Organization_inn_key" ON "Organization"("inn");

-- Трек G2: FunnelStage (словарь стадий воронки продаж) + Lead.funnelStageId.
-- Additive & reversible: new table + new nullable FK column (ON DELETE SET NULL).
-- Existing leads get funnelStageId = NULL → дефолтная стадия по status-якорю.
-- Rollback:
--   ALTER TABLE "Lead" DROP CONSTRAINT "Lead_funnelStageId_fkey";
--   ALTER TABLE "Lead" DROP COLUMN "funnelStageId";
--   DROP TABLE "FunnelStage";

-- CreateTable
CREATE TABLE "FunnelStage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "statusAnchor" "LeadStatus" NOT NULL,
    "color" TEXT,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FunnelStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FunnelStage_companyId_idx" ON "FunnelStage"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelStage_companyId_position_key" ON "FunnelStage"("companyId", "position");

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "funnelStageId" TEXT;

-- AddForeignKey
ALTER TABLE "FunnelStage" ADD CONSTRAINT "FunnelStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_funnelStageId_fkey" FOREIGN KEY ("funnelStageId") REFERENCES "FunnelStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

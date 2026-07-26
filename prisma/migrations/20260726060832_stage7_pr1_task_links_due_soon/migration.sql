-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dueSoonNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "linkedDealId" TEXT,
ADD COLUMN     "linkedLeadId" TEXT;

-- CreateIndex
CREATE INDEX "Task_linkedLeadId_idx" ON "Task"("linkedLeadId");

-- CreateIndex
CREATE INDEX "Task_linkedDealId_idx" ON "Task"("linkedDealId");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedLeadId_fkey" FOREIGN KEY ("linkedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedDealId_fkey" FOREIGN KEY ("linkedDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

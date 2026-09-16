-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "recurrence" JSONB,
ADD COLUMN     "recurrenceParentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceParentId_key" ON "Task"("recurrenceParentId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;


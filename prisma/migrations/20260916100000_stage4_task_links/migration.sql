-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "linkedContactId" TEXT,
ADD COLUMN     "linkedDialogId" TEXT,
ADD COLUMN     "linkedDocumentId" TEXT;

-- CreateIndex
CREATE INDEX "Task_linkedContactId_idx" ON "Task"("linkedContactId");

-- CreateIndex
CREATE INDEX "Task_linkedDialogId_idx" ON "Task"("linkedDialogId");

-- CreateIndex
CREATE INDEX "Task_linkedDocumentId_idx" ON "Task"("linkedDocumentId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedContactId_fkey" FOREIGN KEY ("linkedContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedDialogId_fkey" FOREIGN KEY ("linkedDialogId") REFERENCES "MessengerDialog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedDocumentId_fkey" FOREIGN KEY ("linkedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


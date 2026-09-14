-- Этап 3 ТЗ 12.09.2026 (`У-206`, `У-207`): у диалога появляются ответственный
-- и полноценный статус ожидания.
--
-- Зачем `waitingSince` отдельным полем, а не `lastInboundAt`: сотрудник мог
-- ответить и тут же получить новое входящее — тогда отсчёт SLA начинается
-- заново, а `lastInboundAt` этого не различает.
--
-- Данные НЕ переносим: существующие диалоги остаются в `open`/`closed`,
-- `waitingSince` пуст. Автомат (services/messengers/dialogStatus.ts) расставит
-- статусы по первому же событию. Задним числом «кто кого ждёт» не восстановить,
-- а выдуманный статус сразу же позвал бы руководителя на ложную просрочку.
--
-- Обратный SQL (миграция обратима):
--   DROP INDEX "MessengerDialog_companyId_status_waitingSince_idx";
--   DROP INDEX "MessengerDialog_companyId_assigneeId_idx";
--   ALTER TABLE "MessengerDialog" DROP CONSTRAINT "MessengerDialog_assigneeId_fkey";
--   ALTER TABLE "MessengerDialog"
--     DROP COLUMN "waitingSince", DROP COLUMN "assigneeId",
--     DROP COLUMN "assignedById", DROP COLUMN "assignedAt";

-- AlterTable
ALTER TABLE "MessengerDialog" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "waitingSince" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MessengerDialog_companyId_assigneeId_idx" ON "MessengerDialog"("companyId", "assigneeId");

-- CreateIndex
CREATE INDEX "MessengerDialog_companyId_status_waitingSince_idx" ON "MessengerDialog"("companyId", "status", "waitingSince");

-- AddForeignKey
ALTER TABLE "MessengerDialog" ADD CONSTRAINT "MessengerDialog_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

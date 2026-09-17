-- Этап 5 PR-4 (У-230, Р-Э5-6): дневной дайджест уведомлений.
-- Аддитивно и обратимо: три колонки с умолчаниями и один индекс.
ALTER TABLE "User" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "digestHourMsk" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "User" ADD COLUMN "digestLastSentAt" TIMESTAMP(3);
CREATE INDEX "User_digestEnabled_digestHourMsk_idx" ON "User"("digestEnabled", "digestHourMsk");

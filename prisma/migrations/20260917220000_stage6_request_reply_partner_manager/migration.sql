-- Этап 6 PR-1 (У-238, У-240): ответ сотрудника на обращение; ответственный менеджер партнёра.
-- Аддитивно и обратимо: nullable-колонки, индекс, два внешних ключа с SET NULL.
ALTER TABLE "ClientRequest" ADD COLUMN "staffReply" TEXT;
ALTER TABLE "ClientRequest" ADD COLUMN "staffRepliedAt" TIMESTAMP(3);
ALTER TABLE "ClientRequest" ADD COLUMN "staffRepliedById" TEXT;
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_staffRepliedById_fkey" FOREIGN KEY ("staffRepliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Partner" ADD COLUMN "managerId" TEXT;
CREATE INDEX "Partner_managerId_idx" ON "Partner"("managerId");
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

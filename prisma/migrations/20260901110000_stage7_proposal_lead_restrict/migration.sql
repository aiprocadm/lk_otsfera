-- Этап 7, PR-1 (`У-161`): удаление лида с выставленным КП должно отвечать по делу.
--
-- Предыдущая миграция поставила связи `Document.leadId`/`dealId` с `ON DELETE
-- SET NULL`. Для сделки это верно, для лида — нет, и проверено на живой базе:
-- у КП без контрагента ссылка на лида — ЕДИНСТВЕННЫЙ след адресата, поэтому
-- её обнуление нарушает проверку `Document_proposal_needs_lead`. Удаление
-- лида падало с сообщением «new row for relation "Document" violates check
-- constraint "Document_proposal_needs_lead"»: формально отказ, но по нему
-- непонятно ни что случилось, ни что делать.
--
-- `RESTRICT` отвечает прямо: лид с выставленным предложением не удаляется,
-- пока предложение существует. Отдельной миграцией, а не правкой предыдущей:
-- применённые миграции не редактируют (§2 CLAUDE.md) — иначе у всех, кто их
-- уже накатил, разъедется контрольная сумма.
ALTER TABLE "Document" DROP CONSTRAINT "Document_leadId_fkey";
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

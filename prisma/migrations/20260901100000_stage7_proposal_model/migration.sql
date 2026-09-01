-- Этап 7 (`У-161`, `У-162`, `У-164`): коммерческое предложение как документ.
-- Миграция аддитивная: ни одной существующей строки не меняет.
-- Значение перечисления `commercial_proposal` добавлено ПРЕДЫДУЩЕЙ миграцией:
-- Postgres не разрешает использовать его в той же транзакции, где оно заведено.

-- Срок действия КП по умолчанию (`У-162`), у каждой компании свой.
ALTER TABLE "Company" ADD COLUMN "proposalValidDays" INTEGER NOT NULL DEFAULT 14;

-- `У-164`: цена строки указана с НДС или без. Существующим строкам ставим
-- `true` — так считает `lineMath` по умолчанию, и это же значение писал
-- генератор до этапа 7. Признак нужен переносу строк КП в заказ: без него
-- сумма заказа разошлась бы с суммой предложения ровно на ставку налога.
ALTER TABLE "DocumentLine" ADD COLUMN "vatIncluded" BOOLEAN NOT NULL DEFAULT true;

-- `У-161`: у КП контрагента может не быть — его выставляют клиенту, которого
-- ещё нет в системе. Поля становятся необязательными, но свободы это не даёт:
-- ниже три проверки возвращают ровно те гарантии, что были, и добавляют новую.
ALTER TABLE "Document" ALTER COLUMN "counterpartyType" DROP NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "counterpartyId" DROP NOT NULL;

ALTER TABLE "Document" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Document" ADD COLUMN "dealId" TEXT;
ALTER TABLE "Document" ADD COLUMN "validUntil" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "rejectReason" TEXT;

CREATE INDEX "Document_leadId_idx" ON "Document"("leadId");
CREATE INDEX "Document_dealId_idx" ON "Document"("dealId");
CREATE INDEX "Document_validUntil_idx" ON "Document"("validUntil");

-- Лид или сделка исчезли — документ остаётся, теряя привязку: бумага была
-- выставлена, и вычёркивать её значило бы переписывать историю.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Проверка 1. Контрагент заполнен ЦЕЛИКОМ или не заполнен вовсе. Половина
-- («тип есть, идентификатора нет») не значит ничего и сломала бы канальные
-- выборки, которые сравнивают обе части сразу.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_counterparty_both_or_none" CHECK (
    ("counterpartyType" IS NULL AND "counterpartyId" IS NULL) OR
    ("counterpartyType" IS NOT NULL AND "counterpartyId" IS NOT NULL)
  );

-- Проверка 2. Пустой контрагент допустим ТОЛЬКО у КП. Остальным типам он
-- обязателен ровно как раньше — послабление не должно расползтись на счета,
-- акты и договоры, у которых адресат есть всегда.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_counterparty_required_unless_proposal" CHECK (
    "counterpartyId" IS NOT NULL OR "type" = 'commercial_proposal'
  );

-- Проверка 3. КП без контрагента обязано висеть на лиде. Иначе бумага
-- оказалась бы вообще ни к кому не привязана: ни кабинета, ни карточки, ни
-- способа её найти — только поиск по номеру.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_proposal_needs_lead" CHECK (
    "counterpartyId" IS NOT NULL OR "leadId" IS NOT NULL
  );

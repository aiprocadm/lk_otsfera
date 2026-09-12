-- Этап 1 ТЗ 12.09.2026 «Контакты и внутренние заметки» (`У-181`, `У-183`,
-- право `crm.contacts`). Спека — docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §2.
--
-- Миграция аддитивная и обратимая: одна новая таблица, одна новая nullable-
-- колонка, два индекса и две правки данных. Ни одна существующая строка не
-- удаляется. Обратный SQL для правок данных — в комментариях рядом.
--
-- `OrganizationNote` — внутренняя заметка по организации, видна только
-- сотрудникам компании-продавца. `ON DELETE CASCADE` по компании и организации:
-- заметка без клиента смысла не имеет; `SET NULL` по автору: заметка переживает
-- уволенного сотрудника — это факт истории клиента.
--
-- `Contact.mergedIntoId` — после объединения дублей второй контакт уходит в
-- архив и помнит главный: старая ссылка редиректит, связи уже перенесены.

-- CreateTable
CREATE TABLE "OrganizationNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "mentionUserIds" TEXT[],
    "pinnedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationNote_organizationId_createdAt_idx" ON "OrganizationNote"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizationNote_companyId_idx" ON "OrganizationNote"("companyId");

-- AddForeignKey
ALTER TABLE "OrganizationNote" ADD CONSTRAINT "OrganizationNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationNote" ADD CONSTRAINT "OrganizationNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationNote" ADD CONSTRAINT "OrganizationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "mergedIntoId" TEXT;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Правка данных 1 (`У-183`, спека §3.6): упоминание в заметке — один тип
-- уведомления `note_mention` и для сделки, и для организации. Правила доставки
-- «событие × роль × канал», заведённые под старым ключом, переезжают, чтобы
-- настройки компаний не пропали молча. Исторические строки `Notification.type`
-- не трогаем — подпись для них даёт псевдоним в реестре (как `tzAlias`).
-- Обратный SQL: UPDATE "NotificationRule" SET "eventType" = 'deal_note_mention' WHERE "eventType" = 'note_mention';
-- data:note_mention
UPDATE "NotificationRule" SET "eventType" = 'note_mention' WHERE "eventType" = 'deal_note_mention';

-- Правка данных 2 (спека §3.2, умолчание `В-1-2`): право `crm.contacts`
-- дописывается всем уже заведённым профилям доступа — иначе включение флага
-- `contacts` молча отняло бы раздел у профилей, созданных до этапа. Новые
-- профили получают право галочкой в редакторе ролей.
-- Обратный SQL: UPDATE "AccessProfile" SET "capabilities" = array_remove("capabilities", 'crm.contacts');
-- data:crm.contacts
UPDATE "AccessProfile" SET "capabilities" = array_append("capabilities", 'crm.contacts') WHERE NOT ('crm.contacts' = ANY("capabilities"));

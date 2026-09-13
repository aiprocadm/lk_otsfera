import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { CONTACT_LIST_PAGE, listContacts } from '@/lib/services/contacts/list';
import { listContactOrgOptions } from '@/lib/services/contacts/orgOptions';
import { listOrganizationNotes } from '@/lib/services/organizationNotes/list';
import { listColleagues } from '@/lib/services/staffChat/mentions';
import {
  isOrgHistoryType,
  listOrgHistory,
  orgHistoryTypesFor,
} from '@/lib/services/organization/orgHistory';
import { OrgContactsSection } from '@/components/organization/org-contacts-section';
import { OrgNotesSection } from '@/components/organization/org-notes-section';
import { OrgHistorySection } from '@/components/organization/org-history-section';
import { PinnedNotesBlock } from '@/components/organization/pinned-notes-block';
import { EmptyState } from '@/components/ui';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import { orgCardTabsFor, type OrgCardTabKey } from '@/lib/navigation/orgCardTabs';
import { listOrgCardEmployees } from '@/lib/services/organization/orgCardEmployees';
import { OrgEmployeesSection } from '@/components/organization/org-employees-section';
import { EgrulFillDialog } from '@/components/organization/egrul-fill-dialog';
import { OrgStaffSettings } from '@/components/organization/org-staff-settings';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { getAutoCreatedFrom1C } from '@/lib/services/organization/autoCreated';
import { AutoCreatedBadge } from '@/components/organization/auto-created-badge';
import { IssueOrderLessDocumentButton } from '@/components/documents/issue-order-less-document-button';
import { ProposalsBlock } from '@/components/documents/proposals-block';
import { listOrganizationProposals } from '@/lib/services/documents/proposalBlocks';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Карточка организации в кабинете руководителя (`У-101`).
 *
 * До этапа 2 своей карточки у руководителя не было: список
 * `/leader/organizations` вёл в `/manager/organizations/[id]` — чужой кабинет с
 * чужими хлебными крошками, из которых нельзя было вернуться к себе. Экран
 * повторяет менеджерский **тем же компонентом** (`Р-23`: общий вид, данные и
 * права — от сервиса роли): `getOrganizationCard` сам держит границу компании
 * (C8), поэтому чужую организацию руководитель не откроет.
 */
export default async function LeaderOrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // `У-95`: состав вкладок — фильтр общего реестра, тот же, что у менеджера.
  const visibleTabs = orgCardTabsFor('leader', { flags: isFeatureEnabled });
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTabKey = visibleTabs.some((t) => t.key === rawTab)
    ? (rawTab as OrgCardTabKey)
    : 'overview';

  const session = await requireManagerLeader();
  const card = await getOrganizationCard(prisma, session, id);
  if (!card) notFound();

  // `У-97`: список грузим только когда вкладка открыта — лишний запрос на
  // каждой вкладке карточки не нужен.
  const skipRaw = Number(typeof sp.skip === 'string' ? sp.skip : '');
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const employees =
    activeTab === 'employees'
      ? await listOrgCardEmployees(prisma, session, { orgId: id, ...(q ? { q } : {}), skip })
      : null;

  // `У-99`: настраиваемые поля живут на вкладке «Настройки», а не под всеми
  // вкладками сразу — под переключателем не должно висеть постороннее (`У-64`).
  const customFields =
    activeTab === 'settings' ? await getFieldsForEntity(prisma, session, 'organization', id) : null;
  // `У-166`: предложения клиента — отдельным блоком и только на своей
  // вкладке: на «Обзоре» этот запрос был бы лишним.
  const proposals =
    activeTab === 'documents'
      ? await listOrganizationProposals(prisma, session, { organizationId: id })
      : null;
  const autoCreated = await getAutoCreatedFrom1C(prisma, id);

  // Этап 1 ТЗ 12.09.2026: вкладки «Контакты» (`У-182`), «Заметки» (`У-183`) и
  // единая «История» (`У-184`) грузятся только когда открыты; «Важное» —
  // закреплённые заметки на «Обзоре».
  const cardBase = `/leader/organizations/${id}`;
  const stageTeamMode = true;
  const contactsData =
    activeTab === 'contacts'
      ? await Promise.all([
          listContacts(prisma, session, stageTeamMode, {
            organizationId: id,
            page: Math.floor(skip / CONTACT_LIST_PAGE) + 1,
          }),
          listContactOrgOptions(prisma, session, stageTeamMode),
        ])
      : null;
  const notesData =
    activeTab === 'notes' || activeTab === 'overview'
      ? await listOrganizationNotes(prisma, session, id)
      : null;
  const colleagues = activeTab === 'notes' ? (await listColleagues(prisma, session)).rows : [];
  const historyType = typeof sp.type === 'string' && isOrgHistoryType(sp.type) ? sp.type : null;
  const historyData =
    activeTab === 'history'
      ? await listOrgHistory(prisma, session, {
          orgId: id,
          ...(historyType ? { type: historyType } : {}),
          skip,
        })
      : null;

  return (
    <div className="space-y-5">
      {/* `У-101`: крошки ведут в СВОЙ список, а не в кабинет менеджера. */}
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('leader', '/leader/organizations', [{ label: card.name }])}
      />
      <AutoCreatedBadge mark={autoCreated} />
      <OrgCardTabs
        card={card}
        activeTab={activeTab}
        tabs={visibleTabs}
        contacts={
          contactsData ? (
            contactsData[0].ok ? (
              <OrgContactsSection
                cabinet="leader"
                organizationId={id}
                items={contactsData[0].items}
                total={contactsData[0].total}
                skip={skip}
                basePath={cardBase}
                searchParams={sp}
                orgOptions={contactsData[1]}
              />
            ) : (
              <EmptyState message="Справочник контактов недоступен: у вашего профиля нет права «Контакты (справочник)» — его выдаёт администратор в настройках доступа." />
            )
          ) : null
        }
        notes={
          activeTab === 'notes' ? (
            notesData?.ok ? (
              <OrgNotesSection
                organizationId={id}
                pinned={notesData.pinned}
                notes={notesData.notes}
                colleagues={colleagues}
              />
            ) : (
              <EmptyState message="Заметки ведут сотрудники учебного центра этой организации — вашей компании она не принадлежит." />
            )
          ) : null
        }
        history={
          historyData ? (
            historyData.ok ? (
              <OrgHistorySection
                cabinet="leader"
                basePath={cardBase}
                searchParams={sp}
                types={orgHistoryTypesFor(isFeatureEnabled)}
                activeType={historyType}
                items={historyData.items}
                total={historyData.total}
                skip={skip}
                mode={historyData.mode}
              />
            ) : (
              <EmptyState message="История доступна сотрудникам учебного центра этой организации — вашей компании она не принадлежит." />
            )
          ) : null
        }
        overviewExtra={
          activeTab === 'overview' && notesData?.ok ? (
            <PinnedNotesBlock notes={notesData.pinned} notesHref={`${cardBase}?tab=notes`} />
          ) : null
        }
        employees={
          employees ? (
            <OrgEmployeesSection
              orgId={id}
              basePath={`/leader/organizations/${id}`}
              searchParams={sp}
              rows={employees.rows}
              total={employees.total}
              canWrite={employees.canWrite}
              take={25}
              skip={skip}
            />
          ) : null
        }
        egrulAction={<EgrulFillDialog organizationId={id} organizationName={card.name} />}
        documentsAction={
          // `У-145`: счёт, договор и ДС можно выставить и без заказа. Право на
          // выпуск проверяет сервер — кнопка только открывает форму.
          isFeatureEnabled('document_generation') ? (
            <IssueOrderLessDocumentButton organizationId={id} />
          ) : null
        }
        proposals={
          proposals?.ok ? (
            <ProposalsBlock rows={proposals.rows} hrefBase="/leader/documents" />
          ) : null
        }
        settings={
          customFields ? (
            <OrgStaffSettings
              cabinet="leader"
              card={card}
              session={session}
              prisma={prisma}
              customFields={customFields}
            />
          ) : null
        }
      />
    </div>
  );
}

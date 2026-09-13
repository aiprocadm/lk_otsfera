import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerForOrg } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
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

export default async function ManagerOrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // `У-95`: состав вкладок — фильтр общего реестра по кабинету и флагам, а не
  // свой список в экране (раньше условия флагов дублировались в каждой роли).
  const visibleTabs = orgCardTabsFor('manager', { flags: isFeatureEnabled });

  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTabKey = visibleTabs.some((t) => t.key === rawTab)
    ? (rawTab as OrgCardTabKey)
    : 'overview';

  const session = await requireManagerForOrg(id);
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

  // §11 ТЗ v0.5: настраиваемые поля организации. `У-99`: живут на вкладке
  // «Настройки», а не под всеми вкладками сразу — под переключателем не должно
  // висеть ничего постороннего (`У-64`).
  const customFields =
    activeTab === 'settings' ? await getFieldsForEntity(prisma, session, 'organization', id) : null;
  // `У-166`: предложения клиента — отдельным блоком и только на своей
  // вкладке: на «Обзоре» этот запрос был бы лишним.
  const proposals =
    activeTab === 'documents'
      ? await listOrganizationProposals(prisma, session, { organizationId: id })
      : null;
  // `У-54`: клиента мог завести импорт выписки — менеджеру это видно сразу.
  const autoCreated = await getAutoCreatedFrom1C(prisma, id);

  // Этап 1 ТЗ 12.09.2026: вкладки «Контакты» (`У-182`), «Заметки» (`У-183`) и
  // единая «История» (`У-184`) грузятся только когда открыты; «Важное» —
  // закреплённые заметки на «Обзоре».
  const cardBase = `/manager/organizations/${id}`;
  // Режим команды нужен только справочнику контактов — на остальных вкладках
  // лишний запрос к компании не делаем.
  const stageTeamMode =
    activeTab === 'contacts' ? await getCompanyTeamVisibility(prisma, session.companyId) : false;
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
      {/* `У-72`: человек видит, из какого раздела пришёл и к кому. */}
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('manager', '/manager/organizations', [{ label: card.name }])}
      />
      {/* У-26 (этап 5): менеджер заводит сотрудника прямо из карточки клиента —
          раньше сотрудника в системе нельзя было создать вообще нигде. */}
      <AutoCreatedBadge mark={autoCreated} />
      <OrgCardTabs
        card={card}
        activeTab={activeTab}
        tabs={visibleTabs}
        contacts={
          contactsData ? (
            contactsData[0].ok ? (
              <OrgContactsSection
                cabinet="manager"
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
                cabinet="manager"
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
              basePath={`/manager/organizations/${id}`}
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
            <ProposalsBlock rows={proposals.rows} hrefBase="/manager/documents" />
          ) : null
        }
        settings={
          customFields ? (
            <OrgStaffSettings
              cabinet="manager"
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

import React from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
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
import { getOrganization, getOrganizationMeta } from '@/lib/services/admin/organizations';
import { listOrgRateHistory } from '@/lib/services/commission/rateHistory';
import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import { ManagersBlock } from '@/components/admin/managers-block';
import { OrganizationEditForm } from '@/components/admin/organization-edit-form';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { getOrgRequisitesByAdmin } from '@/lib/services/admin/counterpartyRequisites';
import { setOrgRequisitesByAdminAction } from '@/server-actions/requisites';
import { AdminRateOverrideForm } from '@/components/admin/admin-rate-override-form';
import { OrgSettingsTab } from '@/components/organization/org-settings-tab';
import { EgrulFillDialog } from '@/components/organization/egrul-fill-dialog';
import { OrgEmployeesSection } from '@/components/organization/org-employees-section';
import { listOrgCardEmployees } from '@/lib/services/organization/orgCardEmployees';
import { OrgCommissionSection } from '@/components/organization/org-commission-section';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { getAutoCreatedFrom1C } from '@/lib/services/organization/autoCreated';
import { AutoCreatedBadge } from '@/components/organization/auto-created-badge';
import { IssueOrderLessDocumentButton } from '@/components/documents/issue-order-less-document-button';
import { ProposalsBlock } from '@/components/documents/proposals-block';
import { listOrganizationProposals } from '@/lib/services/documents/proposalBlocks';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export const dynamic = 'force-dynamic';

/**
 * Карточка организации у администратора (`У-95`, `У-96`, §7.3 ТЗ).
 *
 * До этапа 9 это был плоский набор секций мимо реестра вкладок: сервис
 * карточки не знал Model A и вернул бы администратору null (`⚠` AUDIT от
 * 30.08.2026). Теперь экран — тот же `OrgCardTabs`, что у руководителя и
 * менеджера (`Р-23`: общий вид, данные и права — от сервиса роли), а состав
 * вкладок — `orgCardTabsFor('admin')`. Свои блоки никуда не делись: они
 * переехали во вкладки по реестру («Сотрудники», «Документы», «Настройки»).
 */
export default async function AdminOrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // `У-95`: состав вкладок — фильтр общего реестра, тот же, что у сотрудников ЦО.
  const visibleTabs = orgCardTabsFor('admin', { flags: isFeatureEnabled });
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTabKey = visibleTabs.some((t) => t.key === rawTab)
    ? (rawTab as OrgCardTabKey)
    : 'overview';

  const session = await requireAdmin();
  const card = await getOrganizationCard(prisma, session, id);
  if (!card) notFound();

  // `У-97`: список грузим только когда вкладка открыта.
  const skipRaw = Number(typeof sp.skip === 'string' ? sp.skip : '');
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const employees =
    activeTab === 'employees'
      ? await listOrgCardEmployees(prisma, session, { orgId: id, ...(q ? { q } : {}), skip })
      : null;

  // `У-166`: предложения клиента — только на своей вкладке.
  const proposals =
    activeTab === 'documents'
      ? await listOrganizationProposals(prisma, session, { organizationId: id })
      : null;

  // `У-99`: всё, что нужно вкладке «Настройки» (форма организации, реквизиты
  // для документов, история ставки, настраиваемые поля), грузится только на
  // ней — под переключателем не должно висеть постороннее (`У-64`).
  const settingsData =
    activeTab === 'settings'
      ? await Promise.all([
          getOrganization(prisma, id),
          getOrgRequisitesByAdmin(prisma, session, id),
          listOrgRateHistory(prisma, session, id),
          getFieldsForEntity(prisma, session, 'organization', id),
        ])
      : null;

  // Администратор видит организации всех учебных центров — без названия
  // компании не ответить «где я» (§15).
  const [meta, autoCreated] = await Promise.all([
    getOrganizationMeta(prisma, id),
    getAutoCreatedFrom1C(prisma, id),
  ]);

  // Этап 1 ТЗ 12.09.2026: вкладки «Контакты» (`У-182`), «Заметки» (`У-183`) и
  // единая «История» (`У-184`) грузятся только когда открыты; «Важное» —
  // закреплённые заметки на «Обзоре».
  const cardBase = `/admin/organizations/${id}`;
  const stageTeamMode = false;
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
      {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('admin', '/admin/organizations', [{ label: card.name }])}
      />
      {/* `У-54`: организацию мог завести импорт выписки — человек должен видеть
          это в карточке, а не выяснять по журналу аудита. */}
      <AutoCreatedBadge mark={autoCreated} />
      <OrgCardTabs
        card={card}
        activeTab={activeTab}
        tabs={visibleTabs}
        contacts={
          contactsData ? (
            contactsData[0].ok ? (
              <OrgContactsSection
                cabinet="admin"
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
                cabinet="admin"
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
        headerExtra={
          meta?.company ? (
            <p className="text-sm text-gray-500 mt-1">Компания: {meta.company.name}</p>
          ) : null
        }
        // Раздела «Лиды» у администратора нет (исключение зеркала `leads`), а
        // кабинет менеджера для него мёртвая дверь (Model A) — тема лида текстом.
        leadHref={null}
        employees={
          employees ? (
            <OrgEmployeesSection
              orgId={id}
              basePath={`/admin/organizations/${id}`}
              searchParams={sp}
              rows={employees.rows}
              total={employees.total}
              canWrite={employees.canWrite}
              take={25}
              skip={skip}
            />
          ) : null
        }
        // `У-94`: организации из выписки приходят без ИНН — кнопка «Найти в ЕГРЮЛ».
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
            <ProposalsBlock rows={proposals.rows} hrefBase="/admin/documents" />
          ) : null
        }
        settings={settingsData ? <AdminOrgSettings id={id} data={settingsData} /> : null}
      />
    </div>
  );
}

/**
 * Вкладка «Настройки» у администратора (`У-99`): названия и порядок секций —
 * из реестра `orgSettingsSections`, общего на все кабинеты; состав — прежний
 * (форма организации и реквизиты, доступ в кабинет, менеджеры, ставка
 * партнёра, настраиваемые поля). Права здесь шире, чем у руководителя
 * (`OrgStaffSettings`): назначать менеджеров и править саму организацию
 * может только администратор.
 */
function AdminOrgSettings({
  id,
  data: [org, requisites, rateHistoryResult, customFields],
}: {
  id: string;
  data: [
    Awaited<ReturnType<typeof getOrganization>>,
    Awaited<ReturnType<typeof getOrgRequisitesByAdmin>>,
    Awaited<ReturnType<typeof listOrgRateHistory>>,
    Awaited<ReturnType<typeof getFieldsForEntity>>,
  ];
}) {
  // Карточка уже отдалась (Model A) — организация есть; `getOrganization`
  // мог вернуть null только между двумя запросами.
  if (!org) notFound();
  const rateHistory = rateHistoryResult.ok ? rateHistoryResult.rows : [];
  return (
    <OrgSettingsTab
      cabinet="admin"
      slots={{
        requisites: (
          <div className="space-y-4">
            <OrganizationEditForm org={org} />
            {requisites && (
              <RequisitesCard
                description="Начните вводить название или ИНН — DaData подставит остальное."
                defaults={requisites}
                idPrefix="adm-org-req"
                action={setOrgRequisitesByAdminAction}
                hidden={{ orgId: id }}
              />
            )}
          </div>
        ),
        cabinetAccess: (
          <CustomerAccessSection
            organizationId={id}
            prisma={prisma}
            canInvite={true}
            source="admin"
          />
        ),
        managers: <ManagersBlock orgId={id} prisma={prisma} />,
        commission: (
          <OrgCommissionSection
            rate={org.partnerCommissionRate}
            note={org.partnerCommissionRateNote}
            history={rateHistory}
            form={
              <AdminRateOverrideForm
                organizationId={id}
                initialRate={org.partnerCommissionRate}
                initialNote={org.partnerCommissionRateNote}
              />
            }
          />
        ),
        customFields: (
          <EntityCustomFields fields={customFields} entityType="organization" entityId={id} />
        ),
      }}
    />
  );
}

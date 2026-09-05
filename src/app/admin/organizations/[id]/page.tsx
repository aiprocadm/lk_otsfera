import React from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
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

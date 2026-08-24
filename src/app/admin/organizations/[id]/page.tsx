import React from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
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
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;

  const [org, meta, rateHistoryResult] = await Promise.all([
    getOrganization(prisma, id),
    getOrganizationMeta(prisma, id),
    listOrgRateHistory(prisma, session, id),
  ]);
  if (!org || !meta) notFound();
  const rateHistory = rateHistoryResult.ok ? rateHistoryResult.rows : [];
  // Этап 8 (ФТ-9.2): полный набор реквизитов для автогенерации документов.
  const requisites = await getOrgRequisitesByAdmin(prisma, session, org.id);
  // §11 ТЗ v0.5: настраиваемые поля организации (видимость и право правки —
  // на сервере, см. getValuesForEntity).
  const customFields = await getFieldsForEntity(prisma, session, 'organization', org.id);
  // `У-54`: организацию мог завести импорт выписки — человек должен видеть это
  // в карточке, а не выяснять по журналу аудита.
  const autoCreated = await getAutoCreatedFrom1C(prisma, org.id);
  // `У-97`: сотрудники организации — те самые люди, которых заводит кнопка
  // «Добавить сотрудника». До этого шага у администратора кнопка была, а
  // списка не было вовсе: добавленного человека негде было увидеть.
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const skipRaw = Number(typeof sp.skip === 'string' ? sp.skip : '');
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const employees = await listOrgCardEmployees(prisma, session, {
    orgId: id,
    ...(q ? { q } : {}),
    skip,
  });

  return (
    <div className="space-y-5">
      <div>
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/organizations', [{ label: org.name }])}
        />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">{org.name}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Партнёр: {org.partner?.name ?? 'Без партнёра'}
          {meta.company && <span> · Компания: {meta.company.name}</span>}
        </p>
        <AutoCreatedBadge mark={autoCreated} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">ИНН / КПП</div>
          <div className="text-sm font-mono text-[#111111] mt-1">
            {org.inn ?? '—'}
            {org.kpp && <span className="text-gray-400"> / {org.kpp}</span>}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">1С ID</div>
          <div className="text-sm font-mono text-[#111111] mt-1">{org.externalId ?? '—'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Объёмы</div>
          <div className="text-sm text-[#111111] mt-1">
            {meta._count.orders} заказов · {meta._count.students} сотрудников ·{' '}
            {meta._count.organizationUsers} в кабинете
          </div>
          {/* `У-104`: кнопка «Добавить сотрудника» жила здесь отдельно от
              списка. Теперь она одна и стоит рядом с людьми, которых заводит —
              двух одинаковых действий на экране быть не должно. */}
        </div>
      </div>

      {/* `У-94`: организации из выписки приходят без ИНН — человек должен
          видеть это сразу и иметь кнопку, а не выяснять по пустой строке. */}
      {org.inn === null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-[#111111]">
            <strong>ИНН не указан.</strong> Без него не собрать счёт и акт, а импорт из 1С не свяжет
            организацию по ИНН.
          </p>
          <EgrulFillDialog organizationId={org.id} organizationName={org.name} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[#111111]">Сотрудники</h2>
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
      </section>

      {/* `У-99`: набор настроек организации, его названия и порядок — из
          реестра `orgSettingsSections`, общего на все кабинеты. Раньше это была
          простыня из разрозненных секций, а у партнёра тот же набор назывался
          и лежал иначе (§0.2, правило зеркала). */}
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
                  hidden={{ orgId: org.id }}
                />
              )}
            </div>
          ),
          cabinetAccess: (
            <CustomerAccessSection
              organizationId={org.id}
              prisma={prisma}
              canInvite={true}
              source="admin"
            />
          ),
          managers: <ManagersBlock orgId={org.id} prisma={prisma} />,
          commission: (
            <OrgCommissionSection
              rate={org.partnerCommissionRate}
              note={org.partnerCommissionRateNote}
              history={rateHistory}
              form={
                <AdminRateOverrideForm
                  organizationId={org.id}
                  initialRate={org.partnerCommissionRate}
                  initialNote={org.partnerCommissionRateNote}
                />
              }
            />
          ),
          customFields: (
            <EntityCustomFields
              fields={customFields}
              entityType="organization"
              entityId={org.id}
            />
          ),
        }}
      />
    </div>
  );
}

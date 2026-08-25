import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerForOrg } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
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
  // `У-54`: клиента мог завести импорт выписки — менеджеру это видно сразу.
  const autoCreated = await getAutoCreatedFrom1C(prisma, id);

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

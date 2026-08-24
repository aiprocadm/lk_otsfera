import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import { orgCardTabsFor, type OrgCardTabKey } from '@/lib/navigation/orgCardTabs';
import { listOrgCardEmployees } from '@/lib/services/organization/orgCardEmployees';
import { OrgEmployeesSection } from '@/components/organization/org-employees-section';
import { OrgStaffSettings } from '@/components/organization/org-staff-settings';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { getAutoCreatedFrom1C } from '@/lib/services/organization/autoCreated';
import { AutoCreatedBadge } from '@/components/organization/auto-created-badge';
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
    : 'history';

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
    activeTab === 'settings'
      ? await getFieldsForEntity(prisma, session, 'organization', id)
      : null;
  const autoCreated = await getAutoCreatedFrom1C(prisma, id);

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

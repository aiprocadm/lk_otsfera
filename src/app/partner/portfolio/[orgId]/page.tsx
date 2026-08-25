import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { listOrgCardEmployees } from '@/lib/services/organization/orgCardEmployees';
import { orgCardTabsFor, type OrgCardTabKey } from '@/lib/navigation/orgCardTabs';
import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import { OrgEmployeesSection } from '@/components/organization/org-employees-section';
import { partnerOrgTabHref } from '@/lib/navigation/partnerOrgCard';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Карточка организации в кабинете партнёра (`У-96`).
 *
 * До этого шага у партнёра был **свой** список из пяти вкладок, из которых две
 * были отдельными страницами: состав его карточки разъезжался с остальными
 * кабинетами, а «Заказы», «Обзор» и «Заявки на обучение» ему не показывались
 * вовсе. Теперь состав — фильтр общего реестра, а данные даёт тот же сервис
 * карточки со своей границей (организация его портфеля) и без внутренних
 * блоков учебного центра.
 *
 * «Документы» и «Настройки» остались самостоятельными экранами: там свои
 * фильтры и формы. Реестр ведёт на них — вкладка не может оказаться пустой.
 */
export default async function OrgCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePartner();
  const { orgId } = await params;

  if (!(await canPartnerAccessOrg(session, orgId))) redirect('/forbidden');

  const sp = await searchParams;
  const visibleTabs = orgCardTabsFor('partner', { flags: isFeatureEnabled }).filter(
    // Настройки организации ведёт партнёр-администратор: у остальных этой
    // страницы нет, и вкладка вела бы в отказ.
    (t) => t.key !== 'settings' || isPartnerAdmin(session)
  );
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTabKey = visibleTabs.some((t) => t.key === rawTab)
    ? (rawTab as OrgCardTabKey)
    : 'overview';

  const card = await getOrganizationCard(prisma, session, orgId);
  if (!card) notFound();

  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const skipRaw = Number(typeof sp.skip === 'string' ? sp.skip : '');
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const employees =
    activeTab === 'employees'
      ? await listOrgCardEmployees(prisma, session, { orgId, ...(q ? { q } : {}), skip })
      : null;

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('partner', '/partner/portfolio', [{ label: card.name }])}
      />
      <OrgCardTabs
        card={card}
        activeTab={activeTab}
        tabs={visibleTabs}
        hrefFor={(key) => partnerOrgTabHref(orgId, key)}
        employees={
          employees ? (
            <OrgEmployeesSection
              orgId={orgId}
              basePath={`/partner/portfolio/${orgId}`}
              searchParams={sp}
              rows={employees.rows}
              total={employees.total}
              canWrite={employees.canWrite}
              take={25}
              skip={skip}
            />
          ) : null
        }
      />
    </div>
  );
}

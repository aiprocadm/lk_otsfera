import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';
import { OrgTabs, type TabKey } from '@/components/partner/org-tabs';
import { EmployeesTab } from '@/components/partner/org-employees-tab';
import { CommentsTab } from '@/components/partner/org-comments-tab';
import { HistoryTab } from '@/components/partner/org-history-tab';

const VALID_TABS: TabKey[] = ['employees', 'comments', 'history'];

export default async function OrgCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePartner();

  const { orgId } = await params;

  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  const sp = await searchParams;
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const tab: TabKey = VALID_TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'employees';

  const isAdmin = isPartnerAdmin(session);

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('partner', '/partner/portfolio', [
          { label: card.name },
        ])}
      />
      <OrgCardHeader card={card} />
      <OrgTabs orgId={orgId} active={tab} isAdmin={isAdmin} />
      {/* У-64: под вкладками не рендерится ничего вне переключателя. Блок
          «Доступ к организации» уехал на вкладку «Настройки» (У-61) — раньше он
          стоял здесь и был виден под всеми вкладками сразу. */}
      {tab === 'employees' && (
        <EmployeesTab orgId={orgId} prisma={prisma} session={session} searchParams={sp} />
      )}
      {tab === 'comments' && <CommentsTab orgId={orgId} prisma={prisma} />}
      {tab === 'history' && <HistoryTab orgId={orgId} prisma={prisma} />}
    </div>
  );
}

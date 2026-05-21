import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg, isPartnerAdmin } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { OrgTabs, type TabKey } from '@/components/partner/org-tabs';
import { EmployeesTab } from '@/components/partner/org-employees-tab';
import { CommentsTab } from '@/components/partner/org-comments-tab';
import { HistoryTab } from '@/components/partner/org-history-tab';

const VALID_TABS: TabKey[] = ['employees', 'comments', 'history'];

export default async function OrgCardPage({
  params, searchParams
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');

  const { orgId } = await params;

  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  const sp = await searchParams;
  const tab: TabKey = VALID_TABS.includes(sp.tab as TabKey) ? (sp.tab as TabKey) : 'employees';

  return (
    <div className='space-y-4'>
      <OrgCardHeader card={card} />
      <OrgTabs orgId={orgId} active={tab} isAdmin={isPartnerAdmin(session)} />
      {tab === 'employees' && <EmployeesTab orgId={orgId} />}
      {tab === 'comments' && <CommentsTab orgId={orgId} />}
      {tab === 'history' && <HistoryTab orgId={orgId} />}
    </div>
  );
}

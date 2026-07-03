import { notFound } from 'next/navigation';
import { requireManagerForOrg } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { OrgCardTabs, ORG_CARD_TABS, type OrgCardTab } from '@/components/manager/org-card-tabs';

export const dynamic = 'force-dynamic';

export default async function ManagerOrgDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTab = ORG_CARD_TABS.some((t) => t.key === rawTab) ? (rawTab as OrgCardTab) : 'history';

  const session = await requireManagerForOrg(id);
  const card = await getOrganizationCard(prisma, session, id);
  if (!card) notFound();

  return <OrgCardTabs card={card} activeTab={activeTab} />;
}

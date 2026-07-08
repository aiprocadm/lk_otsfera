import { notFound } from 'next/navigation';
import { requireManagerForOrg } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
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

  // Табы «Обращения»/«Звонки» условны на своих флагах (Task 12/G4, Task 9b/B4) —
  // фильтруем видимый список табов здесь же, чтобы и nav, и ?tab=-валидация были согласованы.
  const visibleTabs = ORG_CARD_TABS.filter(
    (t) =>
      (t.key !== 'inbound_messages' || isFeatureEnabled('inbound_messaging')) &&
      (t.key !== 'calls' || isFeatureEnabled('telephony_mango'))
  );

  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const activeTab: OrgCardTab = visibleTabs.some((t) => t.key === rawTab) ? (rawTab as OrgCardTab) : 'history';

  const session = await requireManagerForOrg(id);
  const card = await getOrganizationCard(prisma, session, id);
  if (!card) notFound();

  return <OrgCardTabs card={card} activeTab={activeTab} tabs={visibleTabs} />;
}

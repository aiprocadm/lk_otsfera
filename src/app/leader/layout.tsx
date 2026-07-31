import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { LeaderAppShell } from '@/components/leader/leader-app-shell';

export default async function LeaderLayout({ children }: { children: ReactNode }) {
  // Третья точка гейтинга (после middleware и nav): прямой заход при выключенном флаге -> 404.
  if (!isFeatureEnabled('leader_cabinet')) notFound();
  const session = await requireManagerLeader();
  return <LeaderAppShell session={session}>{children}</LeaderAppShell>;
}

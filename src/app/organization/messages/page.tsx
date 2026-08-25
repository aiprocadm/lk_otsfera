import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireOrganization } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';

import { PageHeader } from '@/components/ui/page-header';
export default async function OrganizationMessagesPage() {
  // Defense-in-depth flag check — middleware already gates, but §4 requires page-level check too
  if (!isFeatureEnabled('chat')) notFound();

  const session = await requireOrganization();

  const result = await listThreads(prisma, session);
  const threads = result.ok ? result.rows : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <>
            Сообщения <UnreadBadge />
          </>
        }
        subtitle="Переписка с менеджером по вашим заказам"
      />
      <OrderThreadInbox threads={threads} currentUserId={session.sub} variant="role" />
    </div>
  );
}

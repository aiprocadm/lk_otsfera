import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';

export default async function PartnerMessagesPage() {
  // Defense-in-depth flag check — middleware already gates, but §4 requires page-level check too
  if (!isFeatureEnabled('chat')) notFound();

  const session = await requirePartner();

  const result = await listThreads(prisma, session);
  const threads = result.ok ? result.rows : [];

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Сообщения<UnreadBadge /></h1>
      <OrderThreadInbox threads={threads} currentUserId={session.sub} variant='role' />
    </div>
  );
}

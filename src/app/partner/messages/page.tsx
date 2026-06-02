import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { PartnerMessagesInbox } from '@/components/partner/partner-messages-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';

export default async function PartnerMessagesPage() {
  // Defense-in-depth flag check — middleware already gates, but §4 requires page-level check too
  if (!isFeatureEnabled('chat')) notFound();

  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'partner' || !session.partnerId) redirect('/forbidden');

  const result = await listThreads(prisma, session);
  const threads = result.ok ? result.rows : [];

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-bold text-[#111111]'>Сообщения<UnreadBadge /></h1>
      <PartnerMessagesInbox threads={threads} currentUserId={session.sub} />
    </div>
  );
}

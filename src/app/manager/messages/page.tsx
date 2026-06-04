import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { TeamChatInbox } from '@/components/chat/team-chat-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';

type SearchParams = { cursor?: string };

export default async function ManagerMessagesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const { rows, nextCursor } = await listIncomingComments(prisma, {
    session,
    withOutgoing: true,
    ...(sp.cursor ? { cursor: sp.cursor } : {})
  });

  const chatEnabled = isFeatureEnabled('chat');
  const chat = chatEnabled ? await listThreads(prisma, session) : null;

  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Сообщения{chatEnabled && <UnreadBadge />}</h1>
      <h2 className='mb-3 text-lg font-medium text-gray-700'>Комментарии к заказам</h2>
      <ManagerMessagesInbox rows={rows} nextCursor={nextCursor} />
      {chatEnabled && chat && (
        <section className='mt-8'>
          <h2 className='mb-3 text-lg font-medium text-gray-700'>Чат</h2>
          <TeamChatInbox
            threads={chat.ok ? chat.rows : []}
            currentUserId={session.sub}
          />
        </section>
      )}
    </>
  );
}

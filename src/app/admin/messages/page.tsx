import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { TeamChatInbox } from '@/components/chat/team-chat-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';

export default async function AdminMessagesPage() {
  const session = await requireAdmin();

  const chatEnabled = isFeatureEnabled('chat');
  const chat = chatEnabled ? await listThreads(prisma, session) : null;

  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Сообщения{chatEnabled && <UnreadBadge />}</h1>
      {chatEnabled && chat ? (
        <section>
          <h2 className='mb-3 text-lg font-medium text-gray-700'>Чат</h2>
          <TeamChatInbox
            threads={chat.ok ? chat.rows : []}
            currentUserId={session.sub}
          />
        </section>
      ) : (
        <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
          <p className='text-gray-500 text-sm'>Чат не включён.</p>
        </div>
      )}
    </>
  );
}

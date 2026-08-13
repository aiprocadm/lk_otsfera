import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { StaffChatSection } from '@/components/staff-chat/staff-chat-section';
import { StaffUnreadBadge } from '@/components/staff-chat/staff-unread-badge';

type SearchParams = { cursor?: string };

export default async function ManagerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const { rows, nextCursor } = await listIncomingComments(prisma, {
    session,
    withOutgoing: true,
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
  });

  const chatEnabled = isFeatureEnabled('chat');
  const chat = chatEnabled ? await listThreads(prisma, session) : null;
  const staffChatEnabled = isFeatureEnabled('staff_chat');

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold text-[#111111]">
        Сообщения{chatEnabled && <UnreadBadge />}
      </h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">Переписка с клиентами по заказам</p>
      <h2 className="mb-3 text-lg font-medium text-gray-700">Комментарии к заказам</h2>
      <ManagerMessagesInbox rows={rows} nextCursor={nextCursor} />
      {chatEnabled && chat && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-medium text-gray-700">Чат</h2>
          <OrderThreadInbox
            threads={chat.ok ? chat.rows : []}
            currentUserId={session.sub}
            variant="team"
          />
        </section>
      )}
      {staffChatEnabled && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-medium text-gray-700">
            Чат команды <StaffUnreadBadge />
          </h2>
          <StaffChatSection currentUserId={session.sub} />
        </section>
      )}
    </>
  );
}

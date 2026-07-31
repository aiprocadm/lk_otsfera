import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { StaffChatSection } from '@/components/staff-chat/staff-chat-section';
import { StaffUnreadBadge } from '@/components/staff-chat/staff-unread-badge';

export default async function AdminMessagesPage() {
  const session = await requireAdmin();

  const chatEnabled = isFeatureEnabled('chat');
  const chat = chatEnabled ? await listThreads(prisma, session) : null;
  const staffChatEnabled = isFeatureEnabled('staff_chat');

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold text-[#111111]">
        Сообщения{chatEnabled && <UnreadBadge />}
      </h1>
      {chatEnabled && chat ? (
        <section>
          <h2 className="mb-3 text-lg font-medium text-gray-700">Чат</h2>
          <OrderThreadInbox
            threads={chat.ok ? chat.rows : []}
            currentUserId={session.sub}
            variant="team"
          />
        </section>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-500 text-sm">Чат не включён.</p>
        </div>
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

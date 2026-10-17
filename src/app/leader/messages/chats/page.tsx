import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { messagesTabsFor } from '@/lib/navigation/messagesTabs';
import { StaffMessages } from '@/components/manager/staff-messages';

export const dynamic = 'force-dynamic';

/**
 * «Сообщения» руководителя → «Чаты с клиентами» (этап 7 ТЗ 13.10.2026, `У-313`):
 * чат по заказам за флагом `chat` — без флага подраздела нет (404), как нет и
 * подпункта меню.
 */
export default async function LeaderMessagesChatsPage() {
  if (!isFeatureEnabled('chat')) notFound();
  const session = await requireManagerLeader();
  const chat = await listThreads(prisma, session);
  return (
    <StaffMessages
      session={session}
      tabs={messagesTabsFor('/leader/messages')}
      data={{ view: 'chats', chat }}
    />
  );
}

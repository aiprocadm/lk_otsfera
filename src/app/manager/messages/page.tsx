import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { listThreads } from '@/lib/services/chat/threads';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffMessages } from '@/components/manager/staff-messages';

/**
 * «Сообщения» менеджера. Экран общий с кабинетом руководителя (`У-110`);
 * база — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function ManagerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const { rows, nextCursor } = await listIncomingComments(prisma, {
    session,
    withOutgoing: true,
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
  });
  // Комментарии видны всегда; треды чата грузим только при флаге `chat`.
  const chat = isFeatureEnabled('chat') ? await listThreads(prisma, session) : null;

  return <StaffMessages session={session} rows={rows} nextCursor={nextCursor} chat={chat} />;
}

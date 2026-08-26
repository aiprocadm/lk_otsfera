import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { listThreads } from '@/lib/services/chat/threads';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffMessages } from '@/components/manager/staff-messages';

export const dynamic = 'force-dynamic';

/**
 * «Сообщения» руководителя (`У-110`). Пункт меню вёл в кабинет менеджера —
 * человек нажимал свой раздел и оказывался в чужом кабинете. Теперь раздел
 * свой, а переписка — по всей компании (`teamModeOverride`); база — здесь,
 * в слое app: компонент презентационный (`components-no-db`).
 */
export default async function LeaderMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const { rows, nextCursor } = await listIncomingComments(prisma, {
    session,
    withOutgoing: true,
    teamModeOverride: true,
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
  });
  // Комментарии видны всегда; треды чата грузим только при флаге `chat`.
  const chat = isFeatureEnabled('chat') ? await listThreads(prisma, session) : null;

  return <StaffMessages session={session} rows={rows} nextCursor={nextCursor} chat={chat} />;
}

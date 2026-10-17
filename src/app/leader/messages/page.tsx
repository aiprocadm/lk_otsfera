import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { messagesTabsFor } from '@/lib/navigation/messagesTabs';
import { StaffMessages } from '@/components/manager/staff-messages';

export const dynamic = 'force-dynamic';

/**
 * «Сообщения» руководителя → «Комментарии по заказам» (`У-110`; этап 7 ТЗ
 * 13.10.2026, `У-313`): подраздел по умолчанию. Охват — вся компания (`teamModeOverride`); база — здесь,
 * в слое app: компонент презентационный (`components-no-db`). Комментарии —
 * до-`chat` фича и видны всегда (§5 CLAUDE.md).
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
  return (
    <StaffMessages
      session={session}
      tabs={messagesTabsFor('/leader/messages')}
      data={{ view: 'comments', rows, nextCursor }}
    />
  );
}

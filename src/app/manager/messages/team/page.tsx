import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { messagesTabsFor } from '@/lib/navigation/messagesTabs';
import { StaffMessages } from '@/components/manager/staff-messages';

export const dynamic = 'force-dynamic';

/**
 * «Сообщения» менеджера → «Чаты команды» (этап 7 ТЗ 13.10.2026, `У-313`): чат
 * сотрудников за флагом `staff_chat` — без флага подраздела нет (404). Беседы
 * грузит сам блок (`/api/staff-chat/*`, только сотрудники).
 */
export default async function ManagerMessagesTeamPage() {
  if (!isFeatureEnabled('staff_chat')) notFound();
  const session = await requireManager();
  return (
    <StaffMessages
      session={session}
      tabs={messagesTabsFor('/manager/messages')}
      data={{ view: 'team' }}
    />
  );
}

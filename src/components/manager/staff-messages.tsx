import React from 'react';
import type { ManagerInboxItem } from '@/lib/services/manager/messages';
import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';
import { isFeatureEnabled } from '@/lib/featureFlags';
import type { ListThreadsResult } from '@/lib/services/chat/threads';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { StaffChatSection } from '@/components/staff-chat/staff-chat-section';
import { StaffUnreadBadge } from '@/components/staff-chat/staff-unread-badge';
import { sectionLabel } from '@/lib/navigation/sectionLabels';
import type { SessionPayload } from '@/lib/auth/jwt';

import { PageHeader } from '@/components/ui/page-header';
/**
 * Экран «Сообщения» сотрудников ЦО — один на кабинет менеджера и кабинет
 * руководителя (`У-110`).
 *
 * У руководителя пункт меню вёл **в чужой кабинет** (`/manager/messages`):
 * человек нажимал раздел своего меню и оказывался в другом кабинете, с чужой
 * подсветкой и чужим охватом. Теперь раздел свой, а переписка — по всей
 * компании (`teamModeOverride` на странице руководителя).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли — она же
 * решает охват (менеджер — свой скоуп, руководитель — вся компания).
 *
 * Гейтинг флага `chat` не выравниваем (§5 CLAUDE.md): комментарии к заказам —
 * до-`chat` фича и видны всегда, чат-секции — только при флаге.
 */
export function StaffMessages({
  session,
  rows,
  nextCursor,
  chat,
}: {
  session: SessionPayload;
  rows: ManagerInboxItem[];
  nextCursor: string | null;
  /** Треды чата; `null` — флаг `chat` выключен, чат-секция не рендерится. */
  chat: ListThreadsResult | null;
}) {
  const chatEnabled = chat !== null;
  const staffChatEnabled = isFeatureEnabled('staff_chat');

  return (
    <>
      <PageHeader
        title={
          <>
            {sectionLabel('messages')} {chatEnabled && <UnreadBadge />}
          </>
        }
        subtitle="Переписка с клиентами по заказам"
      />
      <h2 className="mb-3 text-lg font-medium text-gray-700">Комментарии к заказам</h2>
      <ManagerMessagesInbox rows={rows} nextCursor={nextCursor} />
      {chat && (
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

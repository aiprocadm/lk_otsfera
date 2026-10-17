import React from 'react';
import Link from 'next/link';
import type { ManagerInboxItem } from '@/lib/services/manager/messages';
import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';
import type { ListThreadsResult } from '@/lib/services/chat/threads';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { StaffChatSection } from '@/components/staff-chat/staff-chat-section';
import { StaffUnreadBadge } from '@/components/staff-chat/staff-unread-badge';
import { sectionLabel } from '@/lib/navigation/sectionLabels';
import type { MessagesTab, MessagesTabKey } from '@/lib/navigation/messagesTabs';
import type { SessionPayload } from '@/lib/auth/jwt';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Экран «Сообщения» сотрудников ЦО — один на кабинет менеджера и кабинет
 * руководителя (`У-110`).
 *
 * Этап 7 ТЗ 13.10.2026 (`У-313`, `Р-7-1`): раньше три блока стояли друг под
 * другом, и до «Чата команды» надо было прокрутить все комментарии. Теперь
 * каждый подраздел — своя страница (`view`), подпункт бокового меню и вкладка
 * над экраном; свежее — сразу сверху.
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли — она же
 * решает охват (менеджер — свой скоуп, руководитель — вся компания) и флаги
 * (`chat`, `staff_chat`): страница подраздела без флага отвечает 404.
 */
const SUBTITLE: Record<MessagesTabKey, string> = {
  comments: 'Комментарии клиентов к заказам и ваши ответы — свежие сверху',
  chats: 'Чат с клиентами по заказам',
  team: 'Переписка сотрудников: общий чат и личные сообщения',
};

export type StaffMessagesView =
  | { view: 'comments'; rows: ManagerInboxItem[]; nextCursor: string | null }
  | { view: 'chats'; chat: ListThreadsResult }
  | { view: 'team' };

export function StaffMessages({
  session,
  tabs,
  data,
}: {
  session: SessionPayload;
  /** Подразделы с учётом флагов — из `messagesTabsFor`. */
  tabs: MessagesTab[];
  data: StaffMessagesView;
}) {
  return (
    <>
      <PageHeader
        title={
          <>
            {sectionLabel('messages')} {data.view === 'chats' && <UnreadBadge />}
            {data.view === 'team' && <StaffUnreadBadge />}
          </>
        }
        subtitle={SUBTITLE[data.view]}
      />
      {tabs.length > 1 && (
        <nav aria-label="Подразделы сообщений" className="mb-4 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={t.key === data.view ? 'page' : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                t.key === data.view
                  ? 'border-[#F97316] bg-[#F97316] text-white'
                  : 'border-gray-200 bg-white text-[#111111] hover:border-[#F97316]'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {data.view === 'comments' && (
        <ManagerMessagesInbox rows={data.rows} nextCursor={data.nextCursor} />
      )}
      {data.view === 'chats' && (
        <OrderThreadInbox
          threads={data.chat.ok ? data.chat.rows : []}
          total={data.chat.ok ? data.chat.total : 0}
          currentUserId={session.sub}
          variant="team"
        />
      )}
      {data.view === 'team' && <StaffChatSection currentUserId={session.sub} />}
    </>
  );
}

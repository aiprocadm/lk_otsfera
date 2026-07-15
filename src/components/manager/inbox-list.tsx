import React from 'react';
import { TableShell, THead, Th, Tr, Td, Badge, EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { InboxBindForm } from '@/components/manager/inbox-bind-form';
import { InboxReplyForm } from '@/components/manager/inbox-reply-form';
import type { InboxItem } from '@/lib/services/inbound/listInbox';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Презентационная таблица инбокса (Task 11b). Сервер-компонент — сама не
 * ходит за данными, только рендерит `items` от `listInbox` и встраивает
 * клиентские формы привязки/ответа по статусу строки:
 *  - `unresolved` → форма привязки (`InboxBindForm`);
 *  - `bound`      → форма ответа (`InboxReplyForm`);
 *  - `archived`   → без формы (только просмотр).
 */

const CHANNEL_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
  email: 'Email'
};

const STATUS_TONE: Record<string, 'warning' | 'success' | 'neutral'> = {
  unresolved: 'warning',
  bound: 'success',
  archived: 'neutral'
};

const STATUS_LABEL: Record<string, string> = {
  unresolved: 'Не распознано',
  bound: 'Привязано',
  archived: 'В архиве'
};

function excerpt(body: string, max = 140): string {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function ScanBadge({ scanStatus }: { scanStatus: string }) {
  if (scanStatus === 'none') return null;
  if (scanStatus === 'infected') return <Badge tone="danger">Вложение: заражено</Badge>;
  if (scanStatus === 'pending') return <Badge tone="neutral">Вложение: проверяется</Badge>;
  return <Badge tone="success">Вложение: чисто</Badge>;
}

export function InboxList({
  items,
  organizations,
  contactsEnabled = false
}: {
  items: InboxItem[];
  organizations: ManagerOrgListRow[];
  contactsEnabled?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyState icon="📨" message="Обращений нет" />;
  }

  return (
    <div className="space-y-3">
      <TableShell overflow="x-auto" className="hidden md:block">
        <THead>
          <Th>Канал</Th>
          <Th>Отправитель</Th>
          <Th>Сообщение</Th>
          <Th>Статус</Th>
          <Th>Дата</Th>
          <Th>Действие</Th>
        </THead>
        <tbody>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td>
                <Badge tone="neutral">{CHANNEL_LABEL[item.channel] ?? item.channel}</Badge>
              </Td>
              <Td className="text-gray-700">{item.senderDisplay || item.senderRef}</Td>
              <Td className="max-w-md text-gray-600">
                {item.subject && <p className="font-medium text-[#111111]">{item.subject}</p>}
                <p>{excerpt(item.body)}</p>
                {item.attachmentName && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>📎 {item.attachmentName}</span>
                    <ScanBadge scanStatus={item.scanStatus} />
                  </div>
                )}
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </Badge>
              </Td>
              <Td className="whitespace-nowrap text-gray-500">{fmtDateTime(item.createdAt)}</Td>
              <Td className="min-w-[16rem]">
                {item.status === 'unresolved' && (
                  <InboxBindForm
                    inboundMessageId={item.id}
                    organizations={organizations}
                    contactsEnabled={contactsEnabled}
                  />
                )}
                {item.status === 'bound' && <InboxReplyForm inboundMessageId={item.id} />}
                {item.status === 'archived' && <span className="text-xs text-gray-400">—</span>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {/* Мобильная раскладка — карточки вместо широкой таблицы. */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="neutral">{CHANNEL_LABEL[item.channel] ?? item.channel}</Badge>
              <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                {STATUS_LABEL[item.status] ?? item.status}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-gray-700">{item.senderDisplay || item.senderRef}</p>
            {item.subject && <p className="text-sm font-medium text-[#111111]">{item.subject}</p>}
            <p className="mt-1 text-sm text-gray-600">{excerpt(item.body)}</p>
            {item.attachmentName && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>📎 {item.attachmentName}</span>
                <ScanBadge scanStatus={item.scanStatus} />
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">{fmtDateTime(item.createdAt)}</p>
            <div className="mt-3">
              {item.status === 'unresolved' && (
                <InboxBindForm
                  inboundMessageId={item.id}
                  organizations={organizations}
                  contactsEnabled={contactsEnabled}
                />
              )}
              {item.status === 'bound' && <InboxReplyForm inboundMessageId={item.id} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

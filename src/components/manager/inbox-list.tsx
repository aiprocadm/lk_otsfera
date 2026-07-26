import React from 'react';
import { TableShell, THead, Th, Tr, Td, Badge, EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { InboxBindForm } from '@/components/manager/inbox-bind-form';
import { InboxReplyForm } from '@/components/manager/inbox-reply-form';
import { InboxArchiveButton } from '@/components/manager/inbox-archive-button';
import type { InboxItem } from '@/lib/services/inbound/listInbox';
import { SourceIntakeActions } from '@/components/intake/source-intake-actions';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Презентационная таблица инбокса (Task 11b). Сервер-компонент — сама не
 * ходит за данными, только рендерит `items` от `listInbox` и встраивает
 * клиентские формы привязки/ответа по статусу строки:
 *  - `unresolved` → форма привязки (`InboxBindForm`) + кнопка «В архив»;
 *  - `bound`      → форма ответа (`InboxReplyForm`) + кнопка «В архив»;
 *                   для email вместо формы — подсказка (`BoundReplyControl`, E3);
 *  - `archived`   → кнопка «Вернуть» (`InboxArchiveButton`, E2).
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

/**
 * Имя вложения: при `clean` — ссылка на download-роут (сервер сам
 * переповторяет scope + clean-gate), в остальных статусах — просто текст.
 */
function AttachmentName({ item }: { item: InboxItem }) {
  if (item.scanStatus === 'clean') {
    return (
      <a
        href={`/api/manager/inbox/${item.id}/attachment`}
        className="font-medium text-[#EA580C] hover:underline"
      >
        📎 {item.attachmentName}
      </a>
    );
  }
  return <span>📎 {item.attachmentName}</span>;
}

/**
 * Действие для bound-строки: у email нет исходящей отправки — бэкенд
 * `replyToInbound` всегда отвечает отказом (`email_unsupported`,
 * src/lib/services/inbound/reply.ts), поэтому вместо заведомо падающей
 * формы показываем честную подсказку (E3). Остальные каналы — обычная форма.
 */
function BoundReplyControl({ item }: { item: InboxItem }) {
  if (item.channel === 'email') {
    return (
      <p className="text-xs text-gray-500">
        Ответ по email пока недоступен — ответьте из почтового клиента.
      </p>
    );
  }
  return <InboxReplyForm inboundMessageId={item.id} />;
}

export function InboxList({
  items,
  organizations,
  contactsEnabled = false,
  currentUserId = ''
}: {
  items: InboxItem[];
  organizations: ManagerOrgListRow[];
  contactsEnabled?: boolean;
  /** Этап 7 (ФТ-1.6/7.5): включает «Создать лид»/«Задача» на неразобранных. */
  currentUserId?: string;
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
                    <AttachmentName item={item} />
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
                <div className="space-y-2">
                  {item.status === 'unresolved' && (
                    <InboxBindForm
                      inboundMessageId={item.id}
                      organizations={organizations}
                      contactsEnabled={contactsEnabled}
                    />
                  )}
                  {item.status === 'unresolved' && currentUserId && (
                    <SourceIntakeActions
                      kind="inbound"
                      sourceId={item.id}
                      leadPrefill={{
                        companyName: item.senderDisplay || item.senderRef,
                        contactName: item.senderDisplay || item.senderRef,
                        contactPhone: '',
                        contactEmail: item.channel === 'email' ? item.senderRef : '',
                        subject: item.subject || 'Обращение из внешнего канала'
                      }}
                      taskTitle={`Обращение: ${item.subject || excerpt(item.body)}`}
                      organizationId={item.resolvedOrgId}
                      currentUserId={currentUserId}
                    />
                  )}
                  {item.status === 'bound' && <BoundReplyControl item={item} />}
                  {(item.status === 'unresolved' || item.status === 'bound') && (
                    <InboxArchiveButton inboundMessageId={item.id} mode="archive" />
                  )}
                  {item.status === 'archived' && (
                    <InboxArchiveButton inboundMessageId={item.id} mode="restore" />
                  )}
                </div>
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
                <AttachmentName item={item} />
                <ScanBadge scanStatus={item.scanStatus} />
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">{fmtDateTime(item.createdAt)}</p>
            <div className="mt-3 space-y-2">
              {item.status === 'unresolved' && (
                <InboxBindForm
                  inboundMessageId={item.id}
                  organizations={organizations}
                  contactsEnabled={contactsEnabled}
                />
              )}
              {item.status === 'unresolved' && currentUserId && (
                <SourceIntakeActions
                  kind="inbound"
                  sourceId={item.id}
                  leadPrefill={{
                    companyName: item.senderDisplay || item.senderRef,
                    contactName: item.senderDisplay || item.senderRef,
                    contactPhone: '',
                    contactEmail: item.channel === 'email' ? item.senderRef : '',
                    subject: item.subject || 'Обращение из внешнего канала'
                  }}
                  taskTitle={`Обращение: ${item.subject || excerpt(item.body)}`}
                  organizationId={item.resolvedOrgId}
                  currentUserId={currentUserId}
                />
              )}
              {item.status === 'bound' && <BoundReplyControl item={item} />}
              {(item.status === 'unresolved' || item.status === 'bound') && (
                <InboxArchiveButton inboundMessageId={item.id} mode="archive" />
              )}
              {item.status === 'archived' && (
                <InboxArchiveButton inboundMessageId={item.id} mode="restore" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

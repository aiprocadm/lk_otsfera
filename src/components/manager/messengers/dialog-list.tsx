import React from 'react';
import Link from 'next/link';
import { TableShell, THead, Th, Tr, Td, Badge } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { MESSENGER_LABELS } from '@/lib/services/messengers/channels';
import type { DialogListItem } from '@/lib/services/messengers/list';

/**
 * Список диалогов (спека 2026-09-12 §5.1). Сервер-компонент: данные уже
 * отобраны сервисом по скоупу, здесь только вёрстка. На экране шире планшета —
 * таблица, на телефоне — карточки (`У-16`: таблица шире четырёх колонок
 * превращается в карточки).
 */

function dialogHref(id: string): string {
  return `/manager/messengers/${id}`;
}

function previewText(item: DialogListItem): string {
  if (!item.lastMessagePreview) return '—';
  return item.lastMessageDirection === 'out'
    ? `Вы: ${item.lastMessagePreview}`
    : item.lastMessagePreview;
}

function UnreadPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`Непрочитанных: ${count}`}
      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1.5 text-[11px] font-semibold leading-none text-white"
    >
      {count}
    </span>
  );
}

function OrgCell({ item }: { item: DialogListItem }) {
  if (!item.bound) return <Badge tone="warning">Не привязан</Badge>;
  if (!item.organization) return <span className="text-gray-400">Без организации</span>;
  return (
    <Link
      href={`/manager/organizations/${item.organization.id}`}
      className="text-gray-700 hover:text-orange-600 hover:underline"
    >
      {item.organization.name}
    </Link>
  );
}

export function DialogList({ items }: { items: DialogListItem[] }) {
  return (
    <div className="space-y-3">
      <TableShell overflow="x-auto" className="hidden md:block">
        <THead>
          <Th>Мессенджер</Th>
          <Th>Собеседник</Th>
          <Th>Организация</Th>
          <Th>Последнее сообщение</Th>
          <Th>Когда</Th>
        </THead>
        <tbody>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td>
                <Badge tone="neutral">{MESSENGER_LABELS[item.channel]}</Badge>
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <Link
                    href={dialogHref(item.id)}
                    className="font-medium text-[#111111] hover:text-orange-600"
                  >
                    {item.peerLabel}
                  </Link>
                  <UnreadPill count={item.unreadCount} />
                  {item.status === 'closed' && <Badge tone="neutral">Закрыт</Badge>}
                </div>
              </Td>
              <Td>
                <OrgCell item={item} />
              </Td>
              <Td className="max-w-md text-gray-600">
                <p className="truncate">{previewText(item)}</p>
              </Td>
              <Td className="whitespace-nowrap text-gray-500">{fmtDateTime(item.lastMessageAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <Link
            key={item.id}
            href={dialogHref(item.id)}
            className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-orange-500"
          >
            <div className="flex items-center justify-between gap-2">
              <Badge tone="neutral">{MESSENGER_LABELS[item.channel]}</Badge>
              <div className="flex items-center gap-2">
                {item.status === 'closed' && <Badge tone="neutral">Закрыт</Badge>}
                <UnreadPill count={item.unreadCount} />
              </div>
            </div>
            <p className="mt-2 text-sm font-medium text-[#111111]">{item.peerLabel}</p>
            <p className="text-xs text-gray-500">
              {item.bound ? (item.organization?.name ?? 'Без организации') : 'Не привязан'}
            </p>
            <p className="mt-1 truncate text-sm text-gray-600">{previewText(item)}</p>
            <p className="mt-1 text-xs text-gray-400">{fmtDateTime(item.lastMessageAt)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

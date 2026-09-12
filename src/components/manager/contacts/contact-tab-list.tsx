import React from 'react';
import Link from 'next/link';
import { Badge, EmptyState, Paginator, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { fmtDateTime } from '@/lib/format';
import {
  CONTACT_TAB_PAGE,
  type ContactTabItem,
  type ContactTabKey,
} from '@/lib/services/contacts/get';
import { contactTabItemHref, type ContactsCabinet } from '@/lib/navigation/contactsHrefs';

/** Пустые состояния вкладок — с подсказкой, что сделать (`У-74`). */
const EMPTY_BY_TAB: Record<ContactTabKey, string> = {
  dialogs: 'Диалогов пока нет — напишите первым кнопкой «Написать».',
  calls: 'Звонков с этим человеком ещё не было.',
  inbound: 'Входящих писем от этого человека пока нет.',
  deals: 'Сделок с этим контактом нет — создайте лид и ведите его по воронке.',
  orders:
    'Заказов, где этот человек указан контактом, нет. Контакт заказа выбирается в карточке заказа.',
  history: 'Действий с контактом ещё не было.',
};

/**
 * Содержимое вкладки карточки контакта (`У-179`): одна форма строки на все
 * шесть доменов, ссылка — в кабинет сессии (у администратора нет мессенджеров
 * и звонков — строка без ссылки). «Показаны N из M» — правило хотфиксов
 * №25–№32.
 */
export function ContactTabList({
  cabinet,
  tab,
  items,
  total,
  skip,
  basePath,
  searchParams,
}: {
  cabinet: ContactsCabinet;
  tab: ContactTabKey;
  items: ContactTabItem[];
  total: number;
  skip: number;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (items.length === 0) {
    return <EmptyState icon="📇" title="Здесь пока пусто" message={EMPTY_BY_TAB[tab]} />;
  }
  const titleOf = (item: ContactTabItem) => {
    const href = contactTabItemHref(cabinet, item.kind, item.id);
    return href ? (
      <Link href={href} className="font-medium text-[#111111] hover:text-orange-600">
        {item.title}
      </Link>
    ) : (
      <span className="font-medium text-[#111111]">{item.title}</span>
    );
  };
  return (
    <div className="space-y-3">
      <TableShell overflow="x-auto" className="hidden md:block">
        <THead>
          <Th>Когда</Th>
          <Th>Что</Th>
          <Th>Подробности</Th>
          <Th>Состояние</Th>
        </THead>
        <tbody>
          {items.map((item) => (
            <Tr key={`${item.kind}-${item.id}`}>
              <Td className="whitespace-nowrap text-xs text-gray-500">{fmtDateTime(item.at)}</Td>
              <Td>{titleOf(item)}</Td>
              <Td className="text-gray-700">{item.subtitle ?? '—'}</Td>
              <Td>{item.status ? <Badge tone="neutral">{item.status}</Badge> : '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <CardList>
        {items.map((item) => (
          <Card key={`${item.kind}-${item.id}`} title={titleOf(item)}>
            <CardRow label="Когда">{fmtDateTime(item.at)}</CardRow>
            <CardRow label="Подробности">{item.subtitle}</CardRow>
            <CardRow label="Состояние">{item.status}</CardRow>
          </Card>
        ))}
      </CardList>
      <p className="text-xs text-gray-500">
        Показаны {Math.min(skip + items.length, total)} из {total}
      </p>
      <Paginator
        basePath={basePath}
        searchParams={searchParams}
        take={CONTACT_TAB_PAGE}
        skip={skip}
        total={total}
      />
    </div>
  );
}

import React from 'react';
import Link from 'next/link';
import { EmptyState, Paginator, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { fmtDateTime } from '@/lib/format';
import {
  ORG_HISTORY_PAGE,
  type OrgHistoryItem,
  type OrgHistoryType,
} from '@/lib/services/organization/orgHistory';
import type { ContactsCabinet } from '@/lib/navigation/contactsHrefs';

/** Куда ведёт строка ленты; у администратора нет мессенджеров, звонков и писем — строка без ссылки. */
function historyHref(
  cabinet: ContactsCabinet,
  basePath: string,
  item: OrgHistoryItem
): string | null {
  switch (item.kind) {
    case 'note':
      return `${basePath}?tab=notes`;
    case 'dialog':
      return cabinet === 'admin' ? null : `/manager/messengers/${item.id}`;
    case 'call':
      return cabinet === 'admin' ? null : '/manager/calls';
    case 'inbound':
      return cabinet === 'admin' ? null : '/manager/inbox';
    case 'audit':
      return null;
  }
}

function Pill({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-orange-500 text-white'
          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * Вкладка «История» карточки организации (`У-184`): единая лента событий с
 * фильтром по типу и честной постраничностью — «Показаны N из M»; в режиме
 * «Все типы» показан верх ленты, глубже — по типу (спека §3.8).
 */
export function OrgHistorySection({
  cabinet,
  basePath,
  searchParams,
  types,
  activeType,
  items,
  total,
  skip,
  mode,
}: {
  cabinet: ContactsCabinet;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  types: ReadonlyArray<{ key: OrgHistoryType; label: string }>;
  activeType: OrgHistoryType | null;
  items: OrgHistoryItem[];
  total: number;
  skip: number;
  mode: 'exact' | 'top';
}) {
  const hrefFor = (type: OrgHistoryType | null) =>
    type ? `${basePath}?tab=history&type=${type}` : `${basePath}?tab=history`;
  const titleOf = (item: OrgHistoryItem) => {
    const href = historyHref(cabinet, basePath, item);
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
      <div className="flex flex-wrap gap-1.5">
        <Pill href={hrefFor(null)} active={activeType === null}>
          Все типы
        </Pill>
        {types.map((t) => (
          <Pill key={t.key} href={hrefFor(t.key)} active={activeType === t.key}>
            {t.label}
          </Pill>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState
          message={
            activeType
              ? 'Событий этого типа по организации ещё не было.'
              : 'По этой организации ещё ничего не происходило: ни действий, ни заметок, ни переписки.'
          }
        />
      ) : (
        <>
          <TableShell overflow="x-auto" className="hidden md:block">
            <THead>
              <Th>Когда</Th>
              <Th>Что</Th>
              <Th>Кто</Th>
              <Th>Подробности</Th>
            </THead>
            <tbody>
              {items.map((item) => (
                <Tr key={`${item.kind}-${item.id}`}>
                  <Td className="whitespace-nowrap text-xs text-gray-500">
                    {fmtDateTime(item.at)}
                  </Td>
                  <Td>{titleOf(item)}</Td>
                  <Td className="text-gray-700">{item.actor ?? '—'}</Td>
                  <Td className="text-gray-700">{item.subtitle ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <CardList>
            {items.map((item) => (
              <Card key={`${item.kind}-${item.id}`} title={titleOf(item)}>
                <CardRow label="Когда">{fmtDateTime(item.at)}</CardRow>
                <CardRow label="Кто">{item.actor}</CardRow>
                <CardRow label="Подробности">{item.subtitle}</CardRow>
              </Card>
            ))}
          </CardList>
          <p className="text-xs text-gray-500">
            Показаны {Math.min(skip + items.length, total)} из {total}
            {mode === 'top' && total > skip + items.length
              ? ' — чтобы листать глубже, выберите тип'
              : ''}
          </p>
        </>
      )}
      <Paginator
        basePath={basePath}
        searchParams={searchParams}
        take={ORG_HISTORY_PAGE}
        skip={skip}
        total={total}
      />
    </div>
  );
}

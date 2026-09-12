import React from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, EmptyState, Paginator, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { fmtDate } from '@/lib/format';
import { CONTACT_LIST_PAGE, type ContactListItem } from '@/lib/services/contacts/list';
import type {
  ContactListSearchParams,
  ParsedContactListQuery,
} from '@/lib/services/contacts/listQuery';
import type { ContactOrgOption } from '@/lib/services/contacts/orgOptions';
import { CONTACT_CHANNEL_LABELS } from '@/lib/services/contacts/channelLabels';
import {
  contactHref,
  contactsBase,
  organizationHref,
  type ContactsCabinet,
} from '@/lib/navigation/contactsHrefs';
import { ContactFilters } from './contact-filters';
import { ContactFormDialog } from './contact-form-dialog';

/**
 * Экран «Контакты» (`У-178`, `Р-23`): один презентационный компонент на три
 * зеркальных кабинета ЦО — данные и права даёт сервис роли, здесь только
 * вёрстка и ссылки в СВОЙ кабинет. На телефоне таблица становится карточками
 * (`У-16`).
 */
const CONTACTS_SUBTITLE =
  'Люди, с которыми вы общаетесь: телефоны, почта и мессенджеры в одном месте.';

function ChannelBadges({ channels }: { channels: ContactListItem['channels'] }) {
  if (channels.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {channels.map((ch) => (
        <Badge key={ch.id} tone="neutral">
          {CONTACT_CHANNEL_LABELS[ch.type]}: {ch.value}
        </Badge>
      ))}
    </div>
  );
}

function OrgCell({ cabinet, item }: { cabinet: ContactsCabinet; item: ContactListItem }) {
  if (!item.organization) return <span className="text-gray-400">Без организации</span>;
  return (
    <Link
      href={organizationHref(cabinet, item.organization.id)}
      className="text-gray-700 hover:text-orange-600 hover:underline"
    >
      {item.organization.name}
    </Link>
  );
}

export function ContactsListScreen({
  cabinet,
  query,
  items,
  total,
  searchParams,
  orgOptions,
}: {
  cabinet: ContactsCabinet;
  query: ParsedContactListQuery;
  items: ContactListItem[];
  total: number;
  searchParams: ContactListSearchParams;
  orgOptions: ContactOrgOption[];
}) {
  const base = contactsBase(cabinet);
  const create = <ContactFormDialog cabinet={cabinet} mode="create" orgOptions={orgOptions} />;
  const filtered = Boolean(query.q) || query.scope !== 'all';

  return (
    <div className="space-y-4">
      <PageHeader title="Контакты" subtitle={CONTACTS_SUBTITLE} action={create} />
      <ContactFilters base={base} query={query} />

      {items.length === 0 ? (
        <EmptyState
          icon="📇"
          message={
            filtered
              ? 'Под этот фильтр контактов нет. Снимите фильтр или добавьте контакт.'
              : 'Контактов пока нет — добавьте первого. Контакты появляются и сами: из входящих писем и звонков, когда вы привязываете их к организации.'
          }
          action={create}
        />
      ) : (
        <>
          <TableShell overflow="x-auto" className="hidden md:block">
            <THead>
              <Th>Имя</Th>
              <Th>Должность</Th>
              <Th>Организация</Th>
              <Th>Каналы</Th>
              <Th>Обновлён</Th>
            </THead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link
                        href={contactHref(cabinet, item.id)}
                        className="font-medium text-[#111111] hover:text-orange-600"
                      >
                        {item.name}
                      </Link>
                      {item.isArchived && <Badge tone="neutral">В архиве</Badge>}
                    </div>
                  </Td>
                  <Td className="text-gray-700">{item.position ?? '—'}</Td>
                  <Td>
                    <OrgCell cabinet={cabinet} item={item} />
                  </Td>
                  <Td>
                    <ChannelBadges channels={item.channels} />
                  </Td>
                  <Td className="text-gray-500 text-xs">{fmtDate(item.updatedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <CardList>
            {items.map((item) => (
              <Card
                key={item.id}
                title={
                  <Link href={contactHref(cabinet, item.id)} className="hover:text-orange-600">
                    {item.name}
                  </Link>
                }
              >
                <CardRow label="Должность">{item.position}</CardRow>
                <CardRow label="Организация">
                  <OrgCell cabinet={cabinet} item={item} />
                </CardRow>
                <CardRow label="Каналы">
                  <ChannelBadges channels={item.channels} />
                </CardRow>
                <CardRow label="Обновлён">{fmtDate(item.updatedAt)}</CardRow>
              </Card>
            ))}
          </CardList>
          <p className="text-xs text-gray-500">
            Показаны {Math.min(query.skip + items.length, total)} из {total}
          </p>
        </>
      )}

      <Paginator
        basePath={base}
        searchParams={searchParams}
        take={CONTACT_LIST_PAGE}
        skip={query.skip}
        total={total}
      />
    </div>
  );
}

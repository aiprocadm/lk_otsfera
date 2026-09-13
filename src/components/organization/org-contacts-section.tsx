import React from 'react';
import Link from 'next/link';
import { Badge, EmptyState, Paginator, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { fmtDate } from '@/lib/format';
import { CONTACT_LIST_PAGE, type ContactListItem } from '@/lib/services/contacts/list';
import { CONTACT_CHANNEL_LABELS } from '@/lib/services/contacts/channelLabels';
import type { ContactOrgOption } from '@/lib/services/contacts/orgOptions';
import { contactHref, type ContactsCabinet } from '@/lib/navigation/contactsHrefs';
import { ContactFormDialog } from '@/components/manager/contacts/contact-form-dialog';

/**
 * Вкладка «Контакты» карточки организации (`У-182`): люди этого клиента с
 * каналами связи, кнопка «Добавить контакт» с уже выбранной организацией,
 * ссылки — в карточку контакта своего кабинета. Данные грузит страница роли
 * только когда вкладка открыта.
 */
export function OrgContactsSection({
  cabinet,
  organizationId,
  items,
  total,
  skip,
  basePath,
  searchParams,
  orgOptions,
}: {
  cabinet: ContactsCabinet;
  organizationId: string;
  items: ContactListItem[];
  total: number;
  skip: number;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  orgOptions: ContactOrgOption[];
}) {
  const add = (
    <ContactFormDialog
      cabinet={cabinet}
      mode="create"
      orgOptions={orgOptions}
      defaultOrganizationId={organizationId}
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{add}</div>
      {items.length === 0 ? (
        <EmptyState
          icon="📇"
          message="У организации пока нет контактов — добавьте первого, и письма и звонки этих людей будут находить карточку сами."
          action={add}
        />
      ) : (
        <>
          <TableShell overflow="x-auto" className="hidden md:block">
            <THead>
              <Th>Имя</Th>
              <Th>Должность</Th>
              <Th>Каналы</Th>
              <Th>Обновлён</Th>
            </THead>
            <tbody>
              {items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link
                        href={contactHref(cabinet, c.id)}
                        className="font-medium text-[#111111] hover:text-orange-600"
                      >
                        {c.name}
                      </Link>
                      {c.isArchived && <Badge tone="neutral">В архиве</Badge>}
                    </div>
                  </Td>
                  <Td className="text-gray-700">{c.position ?? '—'}</Td>
                  <Td>
                    {c.channels.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.channels.map((ch) => (
                          <Badge key={ch.id} tone="neutral">
                            {CONTACT_CHANNEL_LABELS[ch.type]}: {ch.value}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td className="text-xs text-gray-500">{fmtDate(c.updatedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <CardList>
            {items.map((c) => (
              <Card
                key={c.id}
                title={
                  <Link href={contactHref(cabinet, c.id)} className="hover:text-orange-600">
                    {c.name}
                  </Link>
                }
              >
                <CardRow label="Должность">{c.position}</CardRow>
                <CardRow label="Каналы">
                  {c.channels.map((ch) => ch.value).join(' · ') || null}
                </CardRow>
                <CardRow label="Обновлён">{fmtDate(c.updatedAt)}</CardRow>
              </Card>
            ))}
          </CardList>
          <p className="text-xs text-gray-500">
            Показаны {Math.min(skip + items.length, total)} из {total}
          </p>
        </>
      )}
      <Paginator
        basePath={basePath}
        searchParams={searchParams}
        take={CONTACT_LIST_PAGE}
        skip={skip}
        total={total}
      />
    </div>
  );
}

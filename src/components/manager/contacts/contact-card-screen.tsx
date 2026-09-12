import React from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, Breadcrumbs, Button } from '@/components/ui';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import type { ContactCardTab } from '@/lib/navigation/contactCardTabs';
import {
  contactHref,
  contactsBase,
  organizationHref,
  writeToContactHref,
  type ContactsCabinet,
} from '@/lib/navigation/contactsHrefs';
import type { ContactTabItem, ContactTabKey, ContactView } from '@/lib/services/contacts/get';
import type { ContactOrgOption } from '@/lib/services/contacts/orgOptions';
import { ArchiveContactButton } from './archive-contact-button';
import { ContactChannels } from './contact-channels';
import { ContactFormDialog } from './contact-form-dialog';
import { ContactTabList } from './contact-tab-list';
import { CreateLeadFromContactButton } from './create-lead-from-contact-button';
import { MergeContactsButton } from './merge-contacts-dialog';

function countOf(contact: ContactView, key: ContactTabKey): number | null {
  switch (key) {
    case 'dialogs':
      return contact.counts.dialogs;
    case 'calls':
      return contact.counts.calls;
    case 'inbound':
      return contact.counts.inbound;
    case 'deals':
      return contact.counts.deals;
    case 'orders':
      return contact.counts.orders;
    case 'history':
      return null;
  }
}

/**
 * Карточка контакта (`У-179`, `Р-23`): один презентационный компонент на три
 * кабинета ЦО. Шапка — имя, должность, организация, кнопки «Написать» и
 * «Создать лид», меню «Изменить · Объединить · В архив»; блок «Каналы»;
 * вкладки по реестру `contactCardTabs.ts`.
 *
 * «Написать» и «Создать лид» ведут в кабинет менеджера: мессенджеры и лиды
 * живут там (`Р-М-5`); руководитель — «играющий тренер», у администратора этих
 * кнопок нет — переписку и лиды он не ведёт (та же причина, что у исключения
 * зеркала для раздела «Мессенджеры»).
 */
export function ContactCardScreen({
  cabinet,
  contact,
  tabs,
  activeTab,
  tabItems,
  tabTotal,
  skip,
  searchParams,
  orgOptions,
  messengersEnabled,
}: {
  cabinet: ContactsCabinet;
  contact: ContactView;
  tabs: ContactCardTab[];
  activeTab: ContactTabKey;
  tabItems: ContactTabItem[];
  tabTotal: number;
  skip: number;
  searchParams: Record<string, string | string[] | undefined>;
  orgOptions: ContactOrgOption[];
  messengersEnabled: boolean;
}) {
  const base = contactsBase(cabinet);
  const self = contactHref(cabinet, contact.id);
  const worksWithClients = cabinet !== 'admin';
  const canWrite =
    worksWithClients &&
    messengersEnabled &&
    !contact.isArchived &&
    contact.messengerChannels.length > 0;
  const writeHint = !messengersEnabled
    ? 'Мессенджеры не подключены — включает администратор в настройках'
    : contact.isArchived
      ? 'Контакт в архиве — верните его, чтобы написать'
      : 'У контакта нет мессенджера — добавьте канал Telegram, MAX или WhatsApp';

  const actions = (
    <div className="flex flex-wrap gap-2">
      {worksWithClients &&
        (canWrite ? (
          <Link href={writeToContactHref(contact.id)}>
            <Button>Написать</Button>
          </Link>
        ) : (
          <Button disabled title={writeHint}>
            Написать
          </Button>
        ))}
      {worksWithClients && !contact.isArchived && (
        <CreateLeadFromContactButton contactId={contact.id} />
      )}
      <ContactFormDialog
        cabinet={cabinet}
        mode="edit"
        orgOptions={orgOptions}
        contact={{
          id: contact.id,
          name: contact.name,
          position: contact.position,
          note: contact.note,
          organizationId: contact.organization?.id ?? null,
        }}
      />
      {!contact.isArchived && (
        <MergeContactsButton cabinet={cabinet} primaryId={contact.id} primaryName={contact.name} />
      )}
      <ArchiveContactButton contactId={contact.id} isArchived={contact.isArchived} />
    </div>
  );

  const subtitle = (
    <>
      {contact.position ? `${contact.position} · ` : ''}
      {contact.organization ? (
        <Link
          href={organizationHref(cabinet, contact.organization.id)}
          className="text-gray-700 hover:text-orange-600 hover:underline"
        >
          {contact.organization.name}
        </Link>
      ) : (
        'Без организации'
      )}
      {contact.user ? ` · пользователь кабинета ${contact.user.email}` : ''}
    </>
  );

  return (
    <div className="space-y-5">
      <Breadcrumbs items={buildCabinetBreadcrumbs(cabinet, base, [{ label: contact.name }])} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {contact.name}
            {contact.isArchived && <Badge tone="neutral">В архиве</Badge>}
          </span>
        }
        subtitle={subtitle}
        action={actions}
      />
      {contact.note && (
        <p className="rounded-md bg-[#F3F4F6] px-3 py-2 text-sm text-gray-700">{contact.note}</p>
      )}

      <ContactChannels
        cabinet={cabinet}
        contactId={contact.id}
        contactName={contact.name}
        channels={contact.channels}
      />

      <nav className="flex flex-wrap gap-1 border-b border-gray-200" aria-label="Вкладки контакта">
        {tabs.map((t) => {
          const count = countOf(contact, t.key);
          return (
            <Link
              key={t.key}
              href={`${self}?tab=${t.key}`}
              data-testid={`contact-tab-${t.key}`}
              data-active={t.key === activeTab}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm ${
                t.key === activeTab
                  ? 'border-[#F97316] font-semibold text-[#EA580C]'
                  : 'border-transparent text-gray-500 hover:text-[#111111]'
              }`}
            >
              {t.label}
              {count !== null && <span className="ml-1 text-xs text-gray-400">{count}</span>}
            </Link>
          );
        })}
      </nav>

      <ContactTabList
        cabinet={cabinet}
        tab={activeTab}
        items={tabItems}
        total={tabTotal}
        skip={skip}
        basePath={self}
        searchParams={searchParams}
      />
    </div>
  );
}

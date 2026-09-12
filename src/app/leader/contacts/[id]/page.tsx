import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';

import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getContact, listContactTab } from '@/lib/services/contacts/get';
import {
  parseContactCardQuery,
  type ContactListSearchParams,
} from '@/lib/services/contacts/listQuery';
import { listContactOrgOptions } from '@/lib/services/contacts/orgOptions';
import { canUseContacts } from '@/lib/services/contacts/scope';
import { contactCardTabsFor } from '@/lib/navigation/contactCardTabs';
import { contactHref } from '@/lib/navigation/contactsHrefs';
import { ContactCardScreen } from '@/components/manager/contacts/contact-card-screen';

export const dynamic = 'force-dynamic';

/**
 * Карточка контакта (этап 1 ТЗ 12.09.2026, `У-179`). Объединённый контакт
 * (`mergedIntoId`) редиректит на главного (`У-181`); вкладка грузится одна —
 * та, что открыта.
 */
export default async function LeaderContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ContactListSearchParams>;
}) {
  if (!isFeatureEnabled('contacts')) notFound();
  const session = await requireManagerLeader();
  if (!canUseContacts(session)) notFound();
  const { id } = await params;
  const sp = await searchParams;
  // Руководитель смотрит на всю компанию — как `/leader/organizations` (`У-101`).
  const teamMode = true;
  const res = await getContact(prisma, session, teamMode, id);
  if (!res.ok) notFound();
  if (res.contact.mergedIntoId) redirect(contactHref('leader', res.contact.mergedIntoId));

  const tabs = contactCardTabsFor({ flags: isFeatureEnabled });
  const { activeTab, skip } = parseContactCardQuery(sp, tabs);
  const [tabRes, orgOptions] = await Promise.all([
    listContactTab(prisma, session, teamMode, { contactId: id, tab: activeTab, skip }),
    listContactOrgOptions(prisma, session, teamMode),
  ]);
  if (!tabRes.ok) notFound();
  return (
    <ContactCardScreen
      cabinet="leader"
      contact={res.contact}
      tabs={tabs}
      activeTab={activeTab}
      tabItems={tabRes.items}
      tabTotal={tabRes.total}
      skip={skip}
      searchParams={sp}
      orgOptions={orgOptions}
      messengersEnabled={isFeatureEnabled('inbound_messaging')}
    />
  );
}

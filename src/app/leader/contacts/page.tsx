import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';

import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listContacts } from '@/lib/services/contacts/list';
import {
  parseContactListQuery,
  type ContactListSearchParams,
} from '@/lib/services/contacts/listQuery';
import { listContactOrgOptions } from '@/lib/services/contacts/orgOptions';
import { canUseContacts } from '@/lib/services/contacts/scope';
import { ContactsListScreen } from '@/components/manager/contacts/contacts-list-screen';

export const dynamic = 'force-dynamic';

/**
 * «Контакты» (этап 1 ТЗ 12.09.2026, `У-178`): справочник людей клиентов.
 * Флаг `contacts` — поведенческий: страница закрывает себя сама; право
 * `crm.contacts` — второй гард (профиль без права → 404, как и чужая роль).
 */
export default async function LeaderContactsPage({
  searchParams,
}: {
  searchParams: Promise<ContactListSearchParams>;
}) {
  if (!isFeatureEnabled('contacts')) notFound();
  const session = await requireManagerLeader();
  if (!canUseContacts(session)) notFound();
  const sp = await searchParams;
  const query = parseContactListQuery(sp);
  // Руководитель смотрит на всю компанию — как `/leader/organizations` (`У-101`).
  const teamMode = true;
  const [result, orgOptions] = await Promise.all([
    listContacts(prisma, session, teamMode, query.filters),
    listContactOrgOptions(prisma, session, teamMode),
  ]);
  if (!result.ok) notFound();
  return (
    <ContactsListScreen
      cabinet="leader"
      query={query}
      items={result.items}
      total={result.total}
      searchParams={sp}
      orgOptions={orgOptions}
    />
  );
}

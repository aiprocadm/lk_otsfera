import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
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
export default async function ManagerContactsPage({
  searchParams,
}: {
  searchParams: Promise<ContactListSearchParams>;
}) {
  if (!isFeatureEnabled('contacts')) notFound();
  const session = await requireManager();
  if (!canUseContacts(session)) notFound();
  const sp = await searchParams;
  const query = parseContactListQuery(sp);
  // `teamMode` — свежим из базы (C8): командная видимость меняется тумблером компании.
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const [result, orgOptions] = await Promise.all([
    listContacts(prisma, session, teamMode, query.filters),
    listContactOrgOptions(prisma, session, teamMode),
  ]);
  if (!result.ok) notFound();
  return (
    <ContactsListScreen
      cabinet="manager"
      query={query}
      items={result.items}
      total={result.total}
      searchParams={sp}
      orgOptions={orgOptions}
    />
  );
}

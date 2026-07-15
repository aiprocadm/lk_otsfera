import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listInbox, type InboxFilters } from '@/lib/services/inbound/listInbox';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { InboxFiltersBar } from '@/components/manager/inbox-filters';
import { InboxList } from '@/components/manager/inbox-list';
import { Paginator } from '@/components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = {
  channel?: string;
  status?: string;
  page?: string;
};

const PAGE_SIZE = 25;

export default async function ManagerInboxPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('inbound_messaging')) notFound();

  const session = await requireManager();
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const status =
    sp.status === 'unresolved' || sp.status === 'bound' || sp.status === 'archived'
      ? sp.status
      : undefined;
  const filters: InboxFilters = {
    ...(sp.channel ? { channel: sp.channel } : {}),
    ...(status ? { status } : {}),
    page,
    pageSize: PAGE_SIZE
  };

  const [{ items, total }, organizations] = await Promise.all([
    listInbox(prisma, session, filters),
    listOrganizations(prisma, session)
  ]);

  const contactsEnabled = isFeatureEnabled('contacts');

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Обращения</h1>
        <p className='mt-1 text-sm text-gray-500'>
          Входящие сообщения из мессенджеров и почты. Привяжите обращение к организации, чтобы ответить.
        </p>
      </div>

      <InboxFiltersBar channel={sp.channel} status={sp.status} />

      <InboxList items={items} organizations={organizations} contactsEnabled={contactsEnabled} />

      <Paginator
        basePath='/manager/inbox'
        searchParams={sp}
        take={PAGE_SIZE}
        skip={(page - 1) * PAGE_SIZE}
        total={total}
      />
    </div>
  );
}

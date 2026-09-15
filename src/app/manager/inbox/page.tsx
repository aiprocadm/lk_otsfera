import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listInbox, type InboxFilters } from '@/lib/services/inbound/listInbox';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { InboxFiltersBar } from '@/components/manager/inbox-filters';
import { InboxList } from '@/components/manager/inbox-list';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

type SearchParams = {
  channel?: string;
  status?: string;
  skip?: string;
  /** `У-215`: одно письмо — переход из ленты диалога. */
  message?: string;
};

const PAGE_SIZE = 25;

// Зеркало CHANNELS из inbox-filters.tsx: бар рендерит пиллы только для этих
// значений, поэтому `?channel=bogus` отбрасывается и не увековечивается в ссылках.
const KNOWN_CHANNELS = new Set(['telegram', 'max', 'whatsapp', 'email', 'cabinet']);

export default async function ManagerInboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('inbound_messaging')) notFound();

  const session = await requireManager();
  const sp = await searchParams;

  // skip-конвенция общего Paginator (см. organization/orders): page выводится из skip
  const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;
  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const status =
    sp.status === 'unresolved' || sp.status === 'bound' || sp.status === 'archived'
      ? sp.status
      : undefined;
  const channel = sp.channel && KNOWN_CHANNELS.has(sp.channel) ? sp.channel : undefined;
  const messageId = typeof sp.message === 'string' && sp.message ? sp.message : undefined;
  const filters: InboxFilters = {
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
    ...(messageId ? { messageId } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const [{ items, total }, organizations] = await Promise.all([
    listInbox(prisma, session, filters),
    listOrganizations(prisma, session),
  ]);

  const contactsEnabled = isFeatureEnabled('contacts');

  return (
    <div className="space-y-4">
      <div>
        {/* Этап 2 ТЗ понятности (У-8): раздел назывался «Обращения» — ровно так
            же, как обращения клиентов, хотя это входящая почта и мессенджеры. */}
        <PageHeader
          title="Входящие письма"
          subtitle="Входящие сообщения из мессенджеров и почты. Привяжите обращение к организации, чтобы ответить."
        />
      </div>

      {messageId ? (
        // Человек пришёл по ссылке из переписки и видит одно письмо. Без этой
        // строки экран выглядел бы как «во «Входящих» осталось одно письмо».
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Показано одно письмо — то, из которого выросла реплика в диалоге.{' '}
          <Link href="/manager/inbox" className="font-medium underline">
            Показать все входящие
          </Link>
        </p>
      ) : (
        <InboxFiltersBar channel={channel} status={status} />
      )}

      <InboxList
        items={items}
        organizations={organizations}
        contactsEnabled={contactsEnabled}
        currentUserId={session.sub}
      />

      <Paginator
        basePath="/manager/inbox"
        searchParams={sp}
        take={PAGE_SIZE}
        skip={(page - 1) * PAGE_SIZE}
        total={total}
      />
    </div>
  );
}

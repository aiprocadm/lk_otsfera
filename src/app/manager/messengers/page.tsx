import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { isMessengerChannel } from '@/lib/services/messengers/channels';
import { listDialogs, type DialogListFilters } from '@/lib/services/messengers/list';
import { listDialogCandidates } from '@/lib/services/messengers/start';
import { DialogFiltersBar } from '@/components/manager/messengers/dialog-filters';
import { DialogList } from '@/components/manager/messengers/dialog-list';
import { NewDialogButton } from '@/components/manager/messengers/new-dialog-button';
import { EmptyState, Paginator } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

type SearchParams = {
  channel?: string;
  status?: string;
  skip?: string;
  /** `?new=<contactId>` — «Написать» из карточки контакта (`У-179`). */
  new?: string;
};

const PAGE_SIZE = 25;

/**
 * «Мессенджеры» (спека 2026-09-12 §5.1): переписка с клиентами в Telegram,
 * MAX и WhatsApp. Флаг `inbound_messaging` — поведенческий (Р-М-4): страница
 * закрывает себя сама, пункт меню и server-actions читают его же.
 */
export default async function ManagerMessengersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('inbound_messaging')) notFound();

  const session = await requireManager();
  const sp = await searchParams;

  const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;
  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const status = sp.status === 'open' || sp.status === 'closed' ? sp.status : undefined;
  const channel = sp.channel && isMessengerChannel(sp.channel) ? sp.channel : undefined;
  const filters: DialogListFilters = {
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const [{ items, total }, candidates] = await Promise.all([
    listDialogs(prisma, session, filters),
    listDialogCandidates(prisma, session),
  ]);

  const preselect = typeof sp.new === 'string' && sp.new ? sp.new : undefined;
  const newDialog = <NewDialogButton candidates={candidates} preselect={preselect} />;
  const filtered = Boolean(channel || status);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Мессенджеры"
        subtitle="Переписка с клиентами в Telegram, MAX и WhatsApp: вся история в одном месте, ответ — отсюда."
        action={newDialog}
      />

      <DialogFiltersBar channel={channel} status={status} />

      {items.length === 0 ? (
        <EmptyState
          icon="📱"
          message={
            filtered
              ? 'Под этот фильтр диалогов нет. Снимите фильтр или начните новый диалог.'
              : 'Диалогов пока нет. Клиент напишет боту — диалог появится здесь. Или начните первым.'
          }
          action={newDialog}
        />
      ) : (
        <DialogList items={items} />
      )}

      <Paginator
        basePath="/manager/messengers"
        searchParams={sp}
        take={PAGE_SIZE}
        skip={(page - 1) * PAGE_SIZE}
        total={total}
      />
    </div>
  );
}

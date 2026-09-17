import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireOrganization } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { listCabinetDialogs } from '@/lib/services/cabinetDialogs/list';
import { getCabinetDialog } from '@/lib/services/cabinetDialogs/get';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { CabinetDialogsPanel } from '@/components/cabinet-dialogs/cabinet-dialogs-panel';
import { MessagesTabs, type MessagesTabKey } from '@/components/cabinet-dialogs/messages-tabs';
import { MissingObjectNotice } from '@/components/ui/missing-object-notice';
import { isMissingObjectRequested, missingObjectHref } from '@/lib/navigation/missingObject';

import { PageHeader } from '@/components/ui/page-header';

const BASE = '/organization/messages';

/**
 * «Сообщения» заказчика: переписка с менеджером (`У-234`) и обсуждение по
 * заказам (командный чат).
 *
 * Гейт — два флага сразу: вкладка «Переписка с менеджером» живёт под
 * `cabinet_questions` (канал кабинета), «По заказам» — под `chat`. Страница
 * открывается, если включён хотя бы один; без обоих — `notFound()`. Нового
 * флага этап не заводит: переписка — экран над уже работающим каналом
 * (`Р-Э6-1`). Префикс снят с `FEATURE_PREFIXES`: edge-middleware умеет
 * проверить один флаг, а здесь их два — гейт живёт на странице и в меню.
 */
export default async function OrganizationMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; dialog?: string; missing?: string }>;
}) {
  const chatEnabled = isFeatureEnabled('chat');
  const cabinetEnabled = isFeatureEnabled('cabinet_questions');
  if (!chatEnabled && !cabinetEnabled) notFound();

  const session = await requireOrganization();
  const sp = await searchParams;

  const tabs: MessagesTabKey[] = [
    ...(cabinetEnabled ? (['manager'] as const) : []),
    ...(chatEnabled ? (['orders'] as const) : []),
  ];
  const requested: MessagesTabKey = sp.tab === 'orders' ? 'orders' : 'manager';
  const active: MessagesTabKey = tabs.includes(requested) ? requested : tabs[0]!;

  const dialogs = active === 'manager' ? await listCabinetDialogs(prisma, session) : [];
  const requestedDialogId = typeof sp.dialog === 'string' ? sp.dialog : null;
  let selected = null;
  if (active === 'manager' && requestedDialogId) {
    const res = await getCabinetDialog(prisma, session, requestedDialogId);
    // Удалённая или чужая переписка — список с плашкой «объект недоступен»,
    // а не 404: ответ один для обоих случаев (`У-232`).
    if (!res.ok) redirect(missingObjectHref(`${BASE}?tab=manager`));
    selected = res.dialog;
  }

  const threads = active === 'orders' ? await listThreads(prisma, session) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={<>Сообщения {chatEnabled ? <UnreadBadge /> : null}</>}
        subtitle="Переписка с менеджером и обсуждение по вашим заказам"
      />
      <MessagesTabs basePath={BASE} active={active} tabs={tabs} />
      {isMissingObjectRequested(sp) && <MissingObjectNotice what="Переписка" />}
      {active === 'manager' ? (
        <CabinetDialogsPanel basePath={BASE} dialogs={dialogs} selected={selected} />
      ) : (
        <OrderThreadInbox
          threads={threads?.ok ? threads.rows : []}
          total={threads?.ok ? threads.total : 0}
          currentUserId={session.sub}
          variant="role"
        />
      )}
    </div>
  );
}

import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listThreads } from '@/lib/services/chat/threads';
import { listOrgOrderConversations } from '@/lib/services/organization/orderConversations';
import { orgOrderScope } from '@/lib/services/organization/memberScope';
import { OrgOrderConversations } from '@/components/organization/org-order-conversations';
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
  searchParams: Promise<{ tab?: string; dialog?: string; missing?: string; org?: string }>;
}) {
  const chatEnabled = isFeatureEnabled('chat');
  const cabinetEnabled = isFeatureEnabled('cabinet_questions');
  if (!chatEnabled && !cabinetEnabled) notFound();

  const sp = await searchParams;
  // Оболочку кабинета заказчика рисует не layout, а каждая страница сама:
  // `layout.tsx` не видит `searchParams`, а активная организация берётся
  // именно оттуда. Цена приёма — про него можно забыть, и тогда экран
  // открывается без меню, шапки и кнопки «Выйти»: человек попадает сюда с
  // кнопки «Написать» на главной и оказывается в тупике. Так и было до
  // сухого прогона приёмки (этап 10). Держит страж `pages.org-app-shell`.
  const ctx = await getOrgPageContext(sp);
  const session = ctx.session;

  // `У-332`: «По заказам» — это прежде всего комментарии к заказам, а они
  // работают без флага чата (CLAUDE.md §5: домен комментариев ≠ домен чата).
  const tabs: MessagesTabKey[] = [...(cabinetEnabled ? (['manager'] as const) : []), 'orders'];
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

  const threads = active === 'orders' && chatEnabled ? await listThreads(prisma, session) : null;
  const conversations =
    active === 'orders'
      ? await listOrgOrderConversations(
          prisma,
          ctx.activeOrgId,
          await orgOrderScope(prisma, session, ctx.activeOrgId)
        )
      : [];

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
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
          <div className="space-y-6">
            <OrgOrderConversations rows={conversations} orgId={ctx.activeOrgId} />
            {chatEnabled && threads?.ok && threads.total > 0 ? (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">Чаты по заказам</h2>
                <OrderThreadInbox
                  threads={threads.rows}
                  total={threads.total}
                  currentUserId={session.sub}
                  variant="role"
                />
              </section>
            ) : null}
          </div>
        )}
      </div>
    </OrgAppShell>
  );
}

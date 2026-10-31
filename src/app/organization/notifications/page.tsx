import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listNotificationsPage } from '@/lib/services/notifications/inbox';
import { readNotificationsSearchParams } from '@/lib/notifications/pageParams';
import { NotificationsScreen } from '@/components/notifications/notifications-screen';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';

export const metadata: Metadata = { title: 'Уведомления' };
export const dynamic = 'force-dynamic';

/**
 * «Уведомления» — кабинет заказчика (`У-228`, `Р-Э5-1`). Оболочка организации
 * своя (шапка с выбором организации), содержимое — общий экран.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('notification_center')) notFound();
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const filters = readNotificationsSearchParams(sp);
  const data = await listNotificationsPage(prisma, ctx.session, filters);
  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <NotificationsScreen
        role="organization"
        basePath="/organization/notifications"
        homeHref="/organization"
        rows={data.rows}
        total={data.total}
        unreadTotal={data.unreadTotal}
        page={data.page}
        pageSize={data.pageSize}
        groupOptions={data.groupOptions}
        unreadOnly={filters.unread === true}
        group={data.group}
        type={data.type}
        searchParams={sp}
      />
    </OrgAppShell>
  );
}

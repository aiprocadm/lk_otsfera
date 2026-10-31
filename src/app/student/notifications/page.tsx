import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listNotificationsPage } from '@/lib/services/notifications/inbox';
import { readNotificationsSearchParams } from '@/lib/notifications/pageParams';
import { NotificationsScreen } from '@/components/notifications/notifications-screen';
import { getSession } from '@/lib/auth/session';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { AppShell } from '@/components/dashboard/app-shell';
import { OrgAppShell } from '@/components/organization/org-app-shell';

export const metadata: Metadata = { title: 'Уведомления' };
export const dynamic = 'force-dynamic';

/**
 * «Уведомления» — кабинет слушателя (`У-228`, `Р-Э5-1`).
 *
 * С этапа 2 ТЗ 13.10.2026 (`У-286`) слушателю приходят три типа о его
 * обучении: назначено обучение, скоро заканчивается срок, истекает
 * удостоверение. Тексты экрана — свои, без заказов и обращений. Оболочка — как у `/student`: орг-пользователь остаётся в оболочке
 * организации, слушатель получает общий шелл.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('notification_center')) notFound();
  const session = await getSession();
  if (!session) notFound();
  const sp = await searchParams;
  const filters = readNotificationsSearchParams(sp);
  const data = await listNotificationsPage(prisma, session, filters);
  const screen = (
    <NotificationsScreen
      role="student"
      basePath="/student/notifications"
      homeHref="/student"
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
  );

  if (session.role === 'organization') {
    const ctx = await getOrgPageContext(sp);
    return (
      <OrgAppShell
        activeOrgName={ctx.activeOrgName}
        memberships={ctx.memberships}
        activeOrgId={ctx.activeOrgId}
        viewerRole={ctx.viewerRole}
      >
        {screen}
      </OrgAppShell>
    );
  }
  return <AppShell>{screen}</AppShell>;
}

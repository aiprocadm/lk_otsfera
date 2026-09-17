import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listNotificationsPage } from '@/lib/services/notifications/inbox';
import { readNotificationsSearchParams } from '@/lib/notifications/pageParams';
import { NotificationsScreen } from '@/components/notifications/notifications-screen';
import { requireManagerLeader } from '@/lib/auth/requireRole';

export const metadata: Metadata = { title: 'Уведомления' };
export const dynamic = 'force-dynamic';

/**
 * «Уведомления» — кабинет руководителя (`У-228`, `Р-Э5-1`). Данные и скоуп — у
 * сервиса; страница только собирает фильтры из адреса и рисует общий экран.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('notification_center')) notFound();
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const filters = readNotificationsSearchParams(sp);
  const data = await listNotificationsPage(prisma, session, filters);
  return (
    <NotificationsScreen
      role="leader"
      basePath="/leader/notifications"
      homeHref="/leader"
      rows={data.rows}
      total={data.total}
      unreadTotal={data.unreadTotal}
      page={data.page}
      pageSize={data.pageSize}
      typeOptions={data.typeOptions}
      unreadOnly={filters.unread === true}
      type={data.type}
      searchParams={sp}
    />
  );
}

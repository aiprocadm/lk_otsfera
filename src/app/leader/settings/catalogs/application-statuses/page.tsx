import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { listStatusDefinitions } from '@/lib/services/orderStatuses';
import { OrderStatusesAdmin } from '@/components/admin/order-statuses-admin';

export const metadata: Metadata = { title: 'Статусы заявок · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * §10 + §4 ТЗ v0.5: справочник статусов настраивают администратор И
 * руководитель. Руководителя не пускаем в `/admin/*` (Model A, §4 CLAUDE.md) —
 * вместо этого зеркало в его кабинете поверх того же компонента и сервиса.
 */
export default async function LeaderOrderStatusesPage() {
  const session = await requireSettingsSection('catalogs.applicationStatuses', 'leader');
  const res = await listStatusDefinitions(prisma, session);
  return <OrderStatusesAdmin rows={res.ok ? res.rows : []} />;
}

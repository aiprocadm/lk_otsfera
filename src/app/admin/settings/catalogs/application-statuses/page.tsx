import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { listStatusDefinitions } from '@/lib/services/orderStatuses';
import { OrderStatusesAdmin } from '@/components/admin/order-statuses-admin';

export const metadata: Metadata = { title: 'Статусы заявок · Настройки' };

export const dynamic = 'force-dynamic';

export default async function AdminApplicationStatusesPage() {
  const session = await requireSettingsSection('catalogs.applicationStatuses', 'admin');
  const res = await listStatusDefinitions(prisma, session);
  return <OrderStatusesAdmin rows={res.ok ? res.rows : []} />;
}

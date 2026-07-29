import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listStatusDefinitions } from '@/lib/services/orderStatuses';
import { OrderStatusesAdmin } from '@/components/admin/order-statuses-admin';

export const dynamic = 'force-dynamic';

export default async function AdminOrderStatusesPage() {
  const session = await requireAdmin();
  const res = await listStatusDefinitions(prisma, session);
  return <OrderStatusesAdmin rows={res.ok ? res.rows : []} />;
}

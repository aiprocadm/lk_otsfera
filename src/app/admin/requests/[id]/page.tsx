import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffClientRequestDetail } from '@/components/client-requests/staff-client-request-detail';

export const dynamic = 'force-dynamic';

/**
 * Деталка обращения в кабинете «admin» (`У-116`). Экрана не было: обращение
 * можно было только развернуть строкой в очереди.
 */
export default async function AdminRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireAdmin();
  return StaffClientRequestDetail({ session, cabinet: 'admin', params });
}

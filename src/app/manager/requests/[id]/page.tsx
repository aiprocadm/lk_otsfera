import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffClientRequestDetail } from '@/components/client-requests/staff-client-request-detail';

export const dynamic = 'force-dynamic';

/**
 * Деталка обращения в кабинете «manager» (`У-116`). Экрана не было: обращение
 * можно было только развернуть строкой в очереди.
 */
export default async function ManagerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireManager();
  return StaffClientRequestDetail({ session, cabinet: 'manager', params });
}

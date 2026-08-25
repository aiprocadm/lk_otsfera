import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffEnrollmentDetail } from '@/components/enrollment/staff-enrollment-detail';

export const dynamic = 'force-dynamic';

/**
 * Деталка заявки на обучение в кабинете «admin» (`У-116`). Экрана не было:
 * заявку можно было только развернуть строкой в очереди.
 */
export default async function AdminEnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requireAdmin();
  return StaffEnrollmentDetail({ session, cabinet: 'admin', params });
}

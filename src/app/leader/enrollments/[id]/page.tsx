import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffEnrollmentDetail } from '@/components/enrollment/staff-enrollment-detail';

export const dynamic = 'force-dynamic';

/**
 * Деталка заявки на обучение в кабинете «leader» (`У-116`). Экрана не было:
 * заявку можно было только развернуть строкой в очереди.
 */
export default async function LeaderEnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requireManagerLeader();
  return StaffEnrollmentDetail({ session, cabinet: 'leader', params });
}

import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { getEnrollmentRequest } from '@/lib/services/enrollments/detail';
import { StaffEnrollmentDetail } from '@/components/enrollment/staff-enrollment-detail';

export const dynamic = 'force-dynamic';

/**
 * Деталка заявки на обучение в кабинете «leader» (`У-116`). Экрана не было:
 * заявку можно было только развернуть строкой в очереди.
 *
 * База — здесь, в слое app: компонент презентационный (`components-no-db`).
 * Скоуп режет сервис: чужая заявка отвечает `not_found`, а не пустой карточкой.
 */
export default async function LeaderEnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const res = await getEnrollmentRequest(prisma, session, id);
  if (!res.ok) notFound();
  return <StaffEnrollmentDetail cabinet="leader" detail={res.request} />;
}

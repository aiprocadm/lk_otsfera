import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getEnrollmentRequest } from '@/lib/services/enrollments/detail';
import { EnrollmentDetailView } from '@/components/enrollment/enrollment-detail-view';

export const dynamic = 'force-dynamic';

/** Деталка заявки на обучение подателя-партнёра (этап 2 PR-2, ФТ-2.3). */
export default async function PartnerEnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requirePartner();
  const { id } = await params;
  // canSee-чек (§4): getEnrollmentRequest скоупит по сессии — чужая заявка = not_found.
  const r = await getEnrollmentRequest(prisma, session, id);
  if (!r.ok) notFound();
  return <EnrollmentDetailView detail={r.request} backHref="/partner/enrollments" />;
}

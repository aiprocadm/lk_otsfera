import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getEnrollmentRequest } from '@/lib/services/enrollments/detail';
import {
  EnrollmentDetailView,
  enrollmentTitle,
} from '@/components/enrollment/enrollment-detail-view';
import { EnrollmentStaffActions } from '@/components/enrollment/enrollment-staff-actions';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Деталка заявки на обучение у сотрудника ЦО (`У-116`).
 *
 * Экрана не было: заявку можно было только развернуть строкой в очереди —
 * поделиться ссылкой или открыть её из уведомления было нельзя.
 *
 * Экран — ТОТ ЖЕ компонент, что видит клиент, плюс действия сотрудника. Скоуп
 * режет сервис: чужая заявка отвечает `not_found`, а не пустой карточкой.
 */
export async function StaffEnrollmentDetail({
  session,
  cabinet,
  params,
}: {
  session: SessionPayload;
  cabinet: 'admin' | 'manager' | 'leader';
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getEnrollmentRequest(prisma, session, id);
  if (!res.ok) notFound();

  const listHref = `/${cabinet}/enrollments`;
  // Слушателей в заявке столько, сколько разных людей в её позициях: одному
  // человеку может идти несколько обучений одной заявкой (`У-43`). Считаем
  // здесь, а не берём из очереди: у деталки своя выборка.
  const studentCount = new Set(res.request.items.map((i) => i.studentId ?? i.fullName)).size;

  return (
    <EnrollmentDetailView
      detail={res.request}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [
        { label: enrollmentTitle(res.request) },
      ])}
      actions={
        <EnrollmentStaffActions
          enrollment={{
            id: res.request.id,
            status: res.request.status,
            studentCount,
            items: res.request.items,
          }}
        />
      }
    />
  );
}

import React from 'react';
import {
  EnrollmentDetailView,
  enrollmentTitle,
} from '@/components/enrollment/enrollment-detail-view';
import { EnrollmentStaffActions } from '@/components/enrollment/enrollment-staff-actions';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import type { EnrollmentDetail } from '@/lib/services/enrollments/detail';

/**
 * Деталка заявки на обучение у сотрудника ЦО (`У-116`).
 *
 * Экрана не было: заявку можно было только развернуть строкой в очереди —
 * поделиться ссылкой или открыть её из уведомления было нельзя.
 *
 * Экран — ТОТ ЖЕ компонент, что видит клиент, плюс действия сотрудника.
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли, скоуп
 * режет сервис `getEnrollmentRequest`: чужая заявка отвечает `not_found`,
 * а не пустой карточкой.
 */
export function StaffEnrollmentDetail({
  cabinet,
  detail,
}: {
  cabinet: 'admin' | 'manager' | 'leader';
  detail: EnrollmentDetail;
}) {
  const listHref = `/${cabinet}/enrollments`;
  // Слушателей в заявке столько, сколько разных людей в её позициях: одному
  // человеку может идти несколько обучений одной заявкой (`У-43`). Считаем
  // здесь, а не берём из очереди: у деталки своя выборка.
  const studentCount = new Set(detail.items.map((i) => i.studentId ?? i.fullName)).size;

  return (
    <EnrollmentDetailView
      detail={detail}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [{ label: enrollmentTitle(detail) }])}
      actions={
        <EnrollmentStaffActions
          enrollment={{
            id: detail.id,
            status: detail.status,
            studentCount,
            items: detail.items,
          }}
        />
      }
    />
  );
}

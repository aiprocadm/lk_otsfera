import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDocuments, listManagerOrderLessDocuments } from '@/lib/services/manager/documents';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import { parseOneCPushStatus } from '@/lib/documents/oneCPushStatus';
import { parseStaffDocumentFilters } from '@/lib/documents/listFilters';
import {
  StaffDocuments,
  type StaffDocumentsSearchParams,
} from '@/components/manager/staff-documents';

/**
 * «Документы» менеджера. Экран общий с кабинетом руководителя (`У-110`) —
 * компонент презентационный (`components-no-db`), база — здесь, в слое app:
 * страница выбирает кабинет и охват (рядовой менеджер видит свой срез) и
 * отдаёт готовые данные пропсами.
 */
export default async function ManagerDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<StaffDocumentsSearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  // `У-169`: фильтр «Выгрузка в 1С» — чужое слово из адреса становится «без фильтра».
  const oneCPushStatus = parseOneCPushStatus(sp.oneCPushStatus);

  if (sp.tab === 'general') {
    const [{ rows }, counterparties] = await Promise.all([
      listManagerOrderLessDocuments(prisma, session, { oneCPushStatus }),
      // Третий аргумент — охват (`У-110`). У рядового менеджера его нет: он
      // видит своих контрагентов, а не всех контрагентов компании.
      listManagerCounterparties(prisma, session, undefined),
    ]);
    return (
      <StaffDocuments cabinet="manager" sp={sp} data={{ tab: 'general', rows, counterparties }} />
    );
  }

  // `У-253`, `У-258`: год, направление, состояние и источник. Разбор общий на
  // оба кабинета — иначе один экран понимал бы адрес иначе, чем другой.
  const filters = parseStaffDocumentFilters(sp);
  const { rows, nextCursor, total } = await listDocuments(prisma, {
    session,
    search: sp.search,
    type: sp.type || undefined,
    orderId: sp.orderId,
    cursor: sp.cursor,
    oneCPushStatus,
    ...filters,
  });
  return (
    <StaffDocuments cabinet="manager" sp={sp} data={{ tab: 'orders', rows, nextCursor, total }} />
  );
}

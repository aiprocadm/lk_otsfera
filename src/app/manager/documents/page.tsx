import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDocuments, listManagerOrderLessDocuments } from '@/lib/services/manager/documents';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
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

  if (sp.tab === 'general') {
    const [{ rows }, counterparties] = await Promise.all([
      listManagerOrderLessDocuments(prisma, session),
      // Третий аргумент — охват (`У-110`). У рядового менеджера его нет: он
      // видит своих контрагентов, а не всех контрагентов компании.
      listManagerCounterparties(prisma, session, undefined),
    ]);
    return (
      <StaffDocuments cabinet="manager" sp={sp} data={{ tab: 'general', rows, counterparties }} />
    );
  }

  const { rows, nextCursor } = await listDocuments(prisma, {
    session,
    search: sp.search,
    type: sp.type || undefined,
    orderId: sp.orderId,
    cursor: sp.cursor,
  });
  return <StaffDocuments cabinet="manager" sp={sp} data={{ tab: 'orders', rows, nextCursor }} />;
}

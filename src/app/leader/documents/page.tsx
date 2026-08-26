import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDocuments, listManagerOrderLessDocuments } from '@/lib/services/manager/documents';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import {
  StaffDocuments,
  type StaffDocumentsSearchParams,
} from '@/components/manager/staff-documents';

export const dynamic = 'force-dynamic';

/**
 * «Документы» руководителя (`У-110`). Раздела не было вовсе: за документами
 * руководитель уходил в кабинет менеджера и видел там **свой** срез, а не срез
 * компании. Экран тот же, компонент презентационный (`components-no-db`) —
 * база здесь, в слое app; охват — вся компания (`teamModeOverride`).
 */
export default async function LeaderDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<StaffDocumentsSearchParams>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;

  if (sp.tab === 'general') {
    const [{ rows }, counterparties] = await Promise.all([
      listManagerOrderLessDocuments(prisma, session),
      // Охват руководителя — вся компания, иначе список получателей окажется
      // уже, чем список самих документов.
      listManagerCounterparties(prisma, session, true),
    ]);
    return (
      <StaffDocuments cabinet="leader" sp={sp} data={{ tab: 'general', rows, counterparties }} />
    );
  }

  const { rows, nextCursor } = await listDocuments(prisma, {
    session,
    search: sp.search,
    type: sp.type || undefined,
    orderId: sp.orderId,
    cursor: sp.cursor,
    teamModeOverride: true,
  });
  return <StaffDocuments cabinet="leader" sp={sp} data={{ tab: 'orders', rows, nextCursor }} />;
}

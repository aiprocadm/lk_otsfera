import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import {
  loadStaffLeadsPage,
  type StaffLeadsSearchParams,
} from '@/lib/services/leads/staffLeadsPage';
import { StaffLeadsScreen } from '@/components/leads/staff-leads-screen';
import { StageConfig } from '@/components/funnel/stage-config';

export const dynamic = 'force-dynamic';

/**
 * «Лиды» руководителя (этап 4 ТЗ 28.10.2026, `У-349`): зеркало менеджера —
 * список и вид «Воронка» внутри одного раздела вместо отдельной «Воронки
 * продаж». Настройка стадий воронки — только у руководителя (сервис стадий
 * пускает admin|leader), поэтому она идёт под доской в виде «Воронка».
 */
export default async function LeaderLeadsPage({
  searchParams,
}: {
  searchParams: Promise<StaffLeadsSearchParams>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const data = await loadStaffLeadsPage(prisma, session, sp);
  const stages = data.board?.stages ?? [];
  const isDefault = stages.length > 0 && stages[0]!.id.startsWith('default:');
  return (
    <StaffLeadsScreen
      basePath="/leader/leads"
      orgCardHrefBase="/leader/organizations"
      data={data}
      sp={sp}
      funnelExtra={data.board ? <StageConfig stages={stages} isDefault={isDefault} /> : null}
    />
  );
}

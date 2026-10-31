import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import {
  loadStaffLeadsPage,
  type StaffLeadsSearchParams,
} from '@/lib/services/leads/staffLeadsPage';
import { StaffLeadsScreen } from '@/components/leads/staff-leads-screen';

export const dynamic = 'force-dynamic';

/**
 * «Лиды» менеджера. Экран и загрузка данных общие с руководителем (`У-349`);
 * воронка — вид `?view=funnel` (`У-312`), за флагом `sales_funnel`.
 */
export default async function ManagerLeadsPage({
  searchParams,
}: {
  searchParams: Promise<StaffLeadsSearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const data = await loadStaffLeadsPage(prisma, session, sp);
  return (
    <StaffLeadsScreen
      basePath="/manager/leads"
      orgCardHrefBase="/manager/organizations"
      data={data}
      sp={sp}
    />
  );
}

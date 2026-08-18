import { NextResponse } from 'next/server';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { listOrdersForExport } from '@/lib/services/manager/orders';
import { renderOrdersXlsx } from '@/lib/services/orders/xlsx';

/**
 * Выгрузка списка заказов сотрудника (этап 9 PR-3, ФТ-12.2). Та же выборка и
 * те же фильтры, что у экрана `/manager/orders` и `/leader/orders`; RBAC-скоуп
 * сервиса не обходится.
 *
 * `?scope=company` — режим кабинета руководителя (company-wide, как
 * `teamModeOverride` на его странице). Принимается ТОЛЬКО от лидера: личный
 * /manager-кабинет лидера остаётся scoped («играющий тренер», CLAUDE.md §4),
 * а обычный менеджер таким параметром скоуп расширить не может.
 *
 * ПДн физлиц в заказах нет (организация, суммы, статусы) — в PiiAccessEvent не
 * пишем.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStaffManagerSide(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const companyWide =
    url.searchParams.get('scope') === 'company' && isManagerLeader(session);

  const { rows, total } = await listOrdersForExport(prisma, {
    session,
    search: url.searchParams.get('search') || undefined,
    executionStatus: url.searchParams.get('executionStatus') || undefined,
    financialStatus: url.searchParams.get('financialStatus') || undefined,
    organizationId: url.searchParams.get('organizationId') || undefined,
    unassigned: url.searchParams.get('unassigned') === '1' || undefined,
    ...(companyWide ? { teamModeOverride: true } : {}),
  });

  const buf = await renderOrdersXlsx({ rows, total });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="orders.xlsx"',
    },
  });
}

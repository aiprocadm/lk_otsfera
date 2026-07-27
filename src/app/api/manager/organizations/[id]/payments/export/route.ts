import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagerAccessOrg } from '@/lib/auth/managerPolicy';
import { getOrgFinanceKpis, listOrgPaymentsForExport } from '@/lib/services/organization/finance';
import { renderPaymentsXlsx } from '@/lib/services/finance/xlsx';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';

/**
 * Выгрузка платежей организации из карточки (вкладка «Оплаты») — staff-путь
 * (этап 9 PR-3, ФТ-12.2). Скоуп — тот же mode-aware предикат, что у страницы
 * карточки (`canManagerAccessOrg`, C8): вне скоупа — 404, чтобы существование
 * чужой организации не утекало. ПДн физлиц в платежах нет — журнал не пишем.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'manager') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  if (!(await canManagerAccessOrg(prisma, session, id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const [{ rows, total }, kpis, org] = await Promise.all([
    listOrgPaymentsForExport(prisma, { organizationId: id, limit: EXPORT_ROW_LIMIT }),
    getOrgFinanceKpis(prisma, id),
    prisma.organization.findUnique({ where: { id }, select: { name: true } })
  ]);

  const buf = await renderPaymentsXlsx({ rows, total, kpis, organizationName: org?.name ?? '—' });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="payments.xlsx"'
    }
  });
}

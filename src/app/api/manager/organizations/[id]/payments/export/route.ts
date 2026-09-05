import { NextResponse } from 'next/server';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagerAccessOrg } from '@/lib/auth/managerPolicy';
import { getPaymentsExportData } from '@/lib/services/finance/paymentsExport';
import { renderPaymentsXlsx } from '@/lib/services/finance/xlsx';

/**
 * Выгрузка платежей организации из карточки (вкладка «Оплаты») — staff-путь
 * (этап 9 PR-3, ФТ-12.2). Скоуп — тот же mode-aware предикат, что у страницы
 * карточки (`canManagerAccessOrg`, C8): вне скоупа — 404, чтобы существование
 * чужой организации не утекало. ПДн физлиц в платежах нет — журнал не пишем.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Этап 9 (PR-1): администратор тоже — та же кнопка на той же карточке
  // (`orgCardTabsFor('admin')`, §7.3 ТЗ); прецедент — `documents/preview`.
  if (!(session.role === 'admin' || isStaffManagerSide(session)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  // Model A: администратору скоуп не нужен, но чужой или несуществующий `id`
  // всё равно 404 — существование организации проверяется по базе.
  const visible =
    session.role === 'admin'
      ? !!(await prisma.organization.findUnique({ where: { id }, select: { id: true } }))
      : await canManagerAccessOrg(prisma, session, id);
  if (!visible) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const data = await getPaymentsExportData(prisma, id);

  const buf = await renderPaymentsXlsx(data);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="payments.xlsx"',
    },
  });
}

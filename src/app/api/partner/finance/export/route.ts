import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { getFinanceKpis, listStatements } from '@/lib/services/partner/finance';
import { renderCommissionStatementsXlsx } from '@/lib/services/finance/commissionXlsx';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';

/**
 * Выгрузка комиссионных отчётов партнёра (`У-115`) — зеркало
 * `/api/organization/finance/export`.
 *
 * Скоуп: `partnerId` берётся ТОЛЬКО из сессии. Никакого параметра «чей партнёр»
 * нет и быть не должно — иначе один партнёр выгрузил бы комиссию другого.
 * Сессия партнёра без `partnerId` — это «ничего не видно», а не «фильтра нет»
 * (тот же приём, что в `getStatementFilePath`).
 *
 * Клиент выгружает СВОИ данные, поэтому запись в журнал доступа к ПДн не
 * делается (ФТ-12.1, как и у заказчика).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'partner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { partnerId } = session;
  if (!partnerId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [kpis, rows, partner] = await Promise.all([
    getFinanceKpis(prisma, partnerId),
    listStatements(prisma, { partnerId, take: EXPORT_ROW_LIMIT }),
    prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true } }),
  ]);

  const buf = await renderCommissionStatementsXlsx({
    rows,
    total: rows.length,
    kpis,
    partnerName: partner?.name ?? 'партнёр',
  });

  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="commission-statements.xlsx"',
    },
  });
}

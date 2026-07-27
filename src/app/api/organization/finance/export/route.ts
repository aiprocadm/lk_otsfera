import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { resolveActiveOrgId } from '@/lib/auth/orgContext';
import { getOrgFinanceKpis, listOrgPaymentsForExport } from '@/lib/services/organization/finance';
import { renderPaymentsXlsx } from '@/lib/services/finance/xlsx';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';

/**
 * Выгрузка платежей и задолженности организации (этап 9 PR-3, ФТ-12.2) —
 * клиентский путь: те же данные, что на `/organization/finance`. Организация
 * выгружает **свои** данные: активная организация резолвится тем же
 * `resolveActiveOrgId` (query → cookie → первая доступная), чужой `?org=`
 * молча игнорируется. Клиентская выгрузка собственных данных в PiiAccessEvent
 * не пишется (ФТ-12.1).
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'organization') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const cookieStore = await cookies();
  const organizationId = resolveActiveOrgId(
    session,
    url.searchParams.get('org'),
    cookieStore.get('org_ctx')?.value ?? null
  );

  const [{ rows, total }, kpis, org] = await Promise.all([
    listOrgPaymentsForExport(prisma, { organizationId, limit: EXPORT_ROW_LIMIT }),
    getOrgFinanceKpis(prisma, organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } })
  ]);

  const buf = await renderPaymentsXlsx({
    rows,
    total,
    kpis,
    organizationName: org?.name ?? '—'
  });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="payments.xlsx"'
    }
  });
}

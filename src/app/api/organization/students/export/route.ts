import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { resolveActiveOrgId } from '@/lib/auth/orgContext';
import { listOrgStudentsForExport } from '@/lib/services/organization/students';
import { renderOrgStudentsXlsx } from '@/lib/services/organization/students-xlsx';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';

/**
 * Выгрузка сотрудников организации (этап 9 PR-3, ФТ-12.2): ФИО, должность,
 * счётчик действующих удостоверений. Та же выборка и тот же поиск, что у
 * экрана `/organization/students`; активная организация резолвится как на
 * странице (query → cookie → первая доступная), чужой `?org=` игнорируется.
 * Клиент выгружает собственные данные — в PiiAccessEvent не пишется (ФТ-12.1).
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

  const { rows, total } = await listOrgStudentsForExport(prisma, {
    organizationId,
    search: url.searchParams.get('search') || undefined,
    limit: EXPORT_ROW_LIMIT
  });

  const buf = await renderOrgStudentsXlsx({ rows, total });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="students.xlsx"'
    }
  });
}

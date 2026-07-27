import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagerAccessOrg } from '@/lib/auth/managerPolicy';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { listCertificates, type CertificateStatusFilter } from '@/lib/services/training/certificates';
import { renderCertificatesXlsx } from '@/lib/services/certificates/xlsx';
import { recordPiiAccess } from '@/lib/pii/record';

/**
 * Выгрузка удостоверений организации из карточки (вкладка «Удостоверения») —
 * staff-путь (этап 9 PR-3, ФТ-12.2). Выборка и фильтры те же, что у вкладки;
 * скоуп сессии не обходится (`listCertificates` пересекает `organizationId` со
 * своим скоупом, доступ к самой карточке — `canManagerAccessOrg`, C8).
 *
 * ФТ-12.1: это выгрузка ПДн физлиц сотрудником — пишем `PiiAccessEvent` с
 * действием `export` (сверх `certificates_list`, который пишет сама выборка).
 */

const STATUSES: CertificateStatusFilter[] = ['active', 'expiring', 'expired'];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('certificates_registry');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'manager') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  if (!(await canManagerAccessOrg(prisma, session, id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const res = await listCertificates(prisma, session, {
    organizationId: id,
    directionId: url.searchParams.get('direction') || undefined,
    status: STATUSES.includes(status as CertificateStatusFilter)
      ? (status as CertificateStatusFilter)
      : undefined,
    search: url.searchParams.get('search') || undefined
  });
  /* v8 ignore next -- listCertificates не возвращает ошибок для read-скоупа; ветка недостижима */
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  await recordPiiAccess(prisma, {
    session,
    context: 'org_card_certificates_export',
    subjectIds: res.certificates.map((c) => c.studentId),
    meta: { take: res.certificates.length, hasQuery: !!url.searchParams.get('search') }
  });

  const buf = await renderCertificatesXlsx({
    rows: res.certificates,
    total: res.total,
    showOrganization: false
  });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="certificates.xlsx"'
    }
  });
}

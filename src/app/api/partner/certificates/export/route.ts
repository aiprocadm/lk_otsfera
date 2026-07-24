import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { listCertificates, type CertificateStatusFilter } from '@/lib/services/training/certificates';
import { renderCertificatesXlsx } from '@/lib/services/certificates/xlsx';

/**
 * Экспорт реестра удостоверений партнёра (этап 3 PR-2, ФТ-6.5/ФТ-12.2):
 * колонка «Организация», те же фильтры, что у экрана
 * (`?organization/direction/status/search`). Скоуп — внутри listCertificates
 * (partner-manager — только закреплённые организации).
 */

const STATUSES: CertificateStatusFilter[] = ['active', 'expiring', 'expired'];

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('certificates_registry');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = requirePartner(session);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const res = await listCertificates(prisma, guard.value, {
    organizationId: url.searchParams.get('organization') || undefined,
    directionId: url.searchParams.get('direction') || undefined,
    status: STATUSES.includes(status as CertificateStatusFilter) ? (status as CertificateStatusFilter) : undefined,
    search: url.searchParams.get('search') || undefined
  });
  /* v8 ignore next -- listCertificates не возвращает ошибок для read-скоупа; ветка недостижима */
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  const buf = await renderCertificatesXlsx({ rows: res.certificates, total: res.total, showOrganization: true });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="partner-certificates.xlsx"'
    }
  });
}

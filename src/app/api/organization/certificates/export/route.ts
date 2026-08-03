import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  listCertificates,
  CERTIFICATE_STATUS_FILTERS,
  type CertificateStatusFilter,
} from '@/lib/services/training/certificates';
import { renderCertificatesXlsx } from '@/lib/services/certificates/xlsx';

/**
 * Экспорт реестра удостоверений организации (этап 3 PR-2, ФТ-6.5/ФТ-12.1).
 * Та же сервис-выборка и фильтры, что у экрана (`?org/direction/status/search`);
 * скоуп сессии не обходится (чужой org даёт пустой файл). Клиентская выгрузка
 * собственных данных — в PiiAccessEvent не пишется (recordPiiAccess no-op для
 * не-staff). Лимит строк — в рендерере.
 */

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('certificates_registry');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'organization')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const res = await listCertificates(prisma, session, {
    organizationId: url.searchParams.get('org') || undefined,
    directionId: url.searchParams.get('direction') || undefined,
    status: CERTIFICATE_STATUS_FILTERS.includes(status as CertificateStatusFilter)
      ? (status as CertificateStatusFilter)
      : undefined,
    search: url.searchParams.get('search') || undefined,
  });
  /* v8 ignore next -- listCertificates не возвращает ошибок для read-скоупа; ветка недостижима */
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  const buf = await renderCertificatesXlsx({
    rows: res.certificates,
    total: res.total,
    showOrganization: false,
  });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="certificates.xlsx"',
    },
  });
}

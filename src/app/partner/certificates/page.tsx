import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listCertificates, type CertificateStatusFilter } from '@/lib/services/training/certificates';
import { CertificateRegistryTable } from '@/components/certificates/certificate-registry-table';
import { CertificateRegistryFilters } from '@/components/certificates/certificate-registry-filters';
import { Paginator } from '@/components/ui/paginator';
import { exportHref } from '@/lib/ui/exportHref';

export const dynamic = 'force-dynamic';

type SearchParams = {
  organization?: string;
  direction?: string;
  status?: string;
  search?: string;
  take?: string;
  skip?: string;
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;
const STATUSES: CertificateStatusFilter[] = ['active', 'expiring', 'expired'];

function parseStatus(raw: string | undefined): CertificateStatusFilter | undefined {
  return STATUSES.includes(raw as CertificateStatusFilter) ? (raw as CertificateStatusFilter) : undefined;
}

/**
 * Реестр удостоверений партнёра (этап 3, ФТ-6.2): + колонка и фильтр
 * «Организация». Скоуп — организации партнёра (внутри listCertificates;
 * partner-manager — пересечение с assignedOrgIds). Селект организаций строится
 * той же границей, чтобы фильтр не подсказывал чужие названия.
 */
export default async function PartnerCertificatesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('certificates_registry')) notFound();
  const session = await requirePartner();
  const sp = await searchParams;

  const take = Math.min(Number.isFinite(Number(sp.take)) && Number(sp.take) > 0 ? Number(sp.take) : DEFAULT_TAKE, MAX_TAKE);
  const skip = Number.isFinite(Number(sp.skip)) && Number(sp.skip) > 0 ? Number(sp.skip) : 0;

  const orgWhere = {
    partnerId: session.partnerId,
    ...(session.partnerRole === 'manager' ? { id: { in: session.assignedOrgIds ?? [] } } : {})
  };

  const [organizations, directions, result] = await Promise.all([
    prisma.organization.findMany({ where: orgWhere, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.trainingDirection.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true }
    }),
    listCertificates(prisma, session, {
      organizationId: sp.organization || undefined,
      directionId: sp.direction || undefined,
      status: parseStatus(sp.status),
      search: sp.search || undefined,
      take,
      skip
    })
  ]);
  /* v8 ignore next -- listCertificates не возвращает ошибок для read-скоупа (Result оставлен на будущее); ветка недостижима */
  if (!result.ok) notFound();

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Удостоверения</h1>
          <p className='text-sm text-gray-500 mt-0.5'>{result.total} всего по вашим организациям</p>
        </div>
        {/* ФТ-6.5: экспорт уважает активные фильтры (те же query-параметры). */}
        <a
          href={exportHref('/api/partner/certificates/export', {
            organization: sp.organization,
            direction: sp.direction,
            status: sp.status,
            search: sp.search
          })}
          className='text-sm font-medium text-[#F97316] border border-[#F97316] hover:bg-[#FFF7ED] rounded-lg px-4 py-2 self-start'
        >
          Выгрузить в Excel
        </a>
      </div>
      <CertificateRegistryFilters
        directions={directions}
        organizations={organizations}
        current={{
          direction: sp.direction,
          status: sp.status,
          search: sp.search,
          organization: sp.organization
        }}
      />
      <CertificateRegistryTable rows={result.certificates} showOrganization />
      <Paginator
        basePath='/partner/certificates'
        searchParams={sp}
        take={take}
        skip={skip}
        total={result.total}
      />
    </div>
  );
}

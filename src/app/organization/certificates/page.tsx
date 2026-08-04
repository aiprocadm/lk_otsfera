import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  listCertificates,
  CERTIFICATE_STATUS_FILTERS,
  type CertificateStatusFilter,
} from '@/lib/services/training/certificates';
import { listDirectionFilterOptions } from '@/lib/services/training/directions';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { CertificateRegistryTable } from '@/components/certificates/certificate-registry-table';
import { CertificateRegistryFilters } from '@/components/certificates/certificate-registry-filters';
import { Paginator } from '@/components/ui/paginator';
import { exportHref } from '@/lib/ui/exportHref';

export const dynamic = 'force-dynamic';

type SearchParams = {
  org?: string;
  direction?: string;
  status?: string;
  search?: string;
  take?: string;
  skip?: string;
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

function parseStatus(raw: string | undefined): CertificateStatusFilter | undefined {
  return CERTIFICATE_STATUS_FILTERS.includes(raw as CertificateStatusFilter)
    ? (raw as CertificateStatusFilter)
    : undefined;
}

/** Реестр удостоверений организации (этап 3, ФТ-6.1). */
export default async function OrganizationCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('certificates_registry')) notFound();
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const take = Math.min(
    Number.isFinite(Number(sp.take)) && Number(sp.take) > 0 ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) && Number(sp.skip) > 0 ? Number(sp.skip) : 0;

  const [directions, result] = await Promise.all([
    listDirectionFilterOptions(prisma),
    listCertificates(prisma, ctx.session, {
      organizationId: ctx.activeOrgId,
      directionId: sp.direction || undefined,
      status: parseStatus(sp.status),
      search: sp.search || undefined,
      take,
      skip,
    }),
  ]);
  /* v8 ignore next -- listCertificates не возвращает ошибок для read-скоупа (Result оставлен на будущее); ветка недостижима */
  if (!result.ok) notFound();

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#111111]">Удостоверения</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {result.total} всего в {ctx.activeOrgName}
            </p>
          </div>
          {/* ФТ-6.5: экспорт уважает активные фильтры (те же query-параметры). */}
          <a
            href={exportHref('/api/organization/certificates/export', {
              org: ctx.activeOrgId,
              direction: sp.direction,
              status: sp.status,
              search: sp.search,
            })}
            className="text-sm font-medium text-[#F97316] border border-[#F97316] hover:bg-[#FFF7ED] rounded-lg px-4 py-2 self-start"
          >
            Выгрузить в Excel
          </a>
        </div>
        <CertificateRegistryFilters
          directions={directions}
          current={{ direction: sp.direction, status: sp.status, search: sp.search }}
          hidden={sp.org ? { org: sp.org } : {}}
        />
        <CertificateRegistryTable
          rows={result.certificates}
          studentHrefBase="/organization/students"
        />
        <Paginator
          basePath="/organization/certificates"
          searchParams={sp}
          take={take}
          skip={skip}
          total={result.total}
        />
      </div>
    </OrgAppShell>
  );
}

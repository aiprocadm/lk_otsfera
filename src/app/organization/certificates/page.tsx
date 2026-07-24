import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listCertificates, type CertificateStatusFilter } from '@/lib/services/training/certificates';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { CertificateRegistryTable } from '@/components/certificates/certificate-registry-table';
import { CertificateRegistryFilters } from '@/components/certificates/certificate-registry-filters';
import { Paginator } from '@/components/ui/paginator';

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
const STATUSES: CertificateStatusFilter[] = ['active', 'expiring', 'expired'];

function parseStatus(raw: string | undefined): CertificateStatusFilter | undefined {
  return STATUSES.includes(raw as CertificateStatusFilter) ? (raw as CertificateStatusFilter) : undefined;
}

/** Реестр удостоверений организации (этап 3, ФТ-6.1). */
export default async function OrganizationCertificatesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('certificates_registry')) notFound();
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const take = Math.min(Number.isFinite(Number(sp.take)) && Number(sp.take) > 0 ? Number(sp.take) : DEFAULT_TAKE, MAX_TAKE);
  const skip = Number.isFinite(Number(sp.skip)) && Number(sp.skip) > 0 ? Number(sp.skip) : 0;

  const [directions, result] = await Promise.all([
    prisma.trainingDirection.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true }
    }),
    listCertificates(prisma, ctx.session, {
      organizationId: ctx.activeOrgId,
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
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-4'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Удостоверения</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {result.total} всего в {ctx.activeOrgName}
          </p>
        </div>
        <CertificateRegistryFilters
          directions={directions}
          current={{ direction: sp.direction, status: sp.status, search: sp.search }}
          hidden={sp.org ? { org: sp.org } : {}}
        />
        <CertificateRegistryTable rows={result.certificates} studentHrefBase='/organization/students' />
        <Paginator
          basePath='/organization/certificates'
          searchParams={sp}
          take={take}
          skip={skip}
          total={result.total}
        />
      </div>
    </OrgAppShell>
  );
}

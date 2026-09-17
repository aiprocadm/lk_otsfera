import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listHubMaterials } from '@/lib/services/partnerMaterials/hub';
import { PartnerMaterialsScreen } from '@/components/partner-materials/partner-materials-screen';

export const metadata: Metadata = { title: 'Материалы для партнёров · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Материалы для партнёров» администратора (`У-237`): администратор выбирает
 * компанию-издателя (`?company=`), по умолчанию — первая по алфавиту.
 * База — здесь, в слое app (`components-no-db`), экран презентационный.
 */
export default async function AdminPartnerMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.partnerMaterials', 'admin');
  const sp = await searchParams;
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const requested = typeof sp.company === 'string' ? sp.company : '';
  const companyId = companies.find((c) => c.id === requested)?.id ?? companies[0]?.id ?? null;
  const res = companyId ? await listHubMaterials(prisma, session, companyId) : null;

  return (
    <PartnerMaterialsScreen
      cabinet="admin"
      companyId={companyId}
      companies={companies}
      rows={res?.ok ? res.rows : []}
    />
  );
}

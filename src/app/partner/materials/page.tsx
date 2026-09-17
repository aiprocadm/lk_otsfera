import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { listPartnerMaterials } from '@/lib/services/partnerMaterials/partner';
import { PartnerMaterialsList } from '@/components/partner/partner-materials-list';
import { PageHeader } from '@/components/ui/page-header';

/**
 * «Материалы» партнёра (`У-237`, `Р-Э6-3`): опубликованные материалы компаний,
 * у которых есть организации этого партнёра. Скоуп держит сервис (§4).
 */
export default async function PartnerMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePartner();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const rows = await listPartnerMaterials(prisma, session, q ? { q } : {});

  return (
    <div className="space-y-5">
      <PageHeader
        title="Материалы"
        subtitle="Прайсы, презентации, шаблоны и инструкции от учебного центра — скачивайте и используйте в работе с клиентами."
      />
      <PartnerMaterialsList rows={rows} q={q} />
    </div>
  );
}

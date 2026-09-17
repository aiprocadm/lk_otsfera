import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listHubMaterials } from '@/lib/services/partnerMaterials/hub';
import { PartnerMaterialsScreen } from '@/components/partner-materials/partner-materials-screen';

export const metadata: Metadata = { title: 'Материалы для партнёров · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Материалы для партнёров» руководителя (`У-237`): только своя компания —
 * компания берётся из сессии, а не из адреса, иначе руководитель одной
 * компании публиковал бы от имени другой, поменяв строку в браузере.
 */
export default async function LeaderPartnerMaterialsPage() {
  const session = await requireSettingsSection('catalogs.partnerMaterials', 'leader');
  const companyId = session.companyId ?? null;
  const res = companyId ? await listHubMaterials(prisma, session, companyId) : null;

  return (
    <PartnerMaterialsScreen
      cabinet="leader"
      companyId={companyId}
      companies={[]}
      rows={res?.ok ? res.rows : []}
    />
  );
}

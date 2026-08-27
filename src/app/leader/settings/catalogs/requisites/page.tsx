import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCompaniesRequisites } from '@/lib/services/admin/companyRequisites';
import { listCompanyBranding, type BrandingSlotView } from '@/lib/services/admin/companyBranding';
import { RequisitesScreen } from '@/components/settings/requisites-screen';

export const metadata: Metadata = { title: 'Реквизиты исполнителя · Настройки' };

/**
 * «Реквизиты исполнителя» руководителя (`У-135`): только своя компания —
 * скоуп держит сервис, а не видимость карточки. Экран общий с админом
 * (`У-138`: плюс налоги, нумерация и оформление);
 * база — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function LeaderRequisitesPage() {
  const session = await requireSettingsSection('catalogs.requisites', 'leader');
  const res = await listCompaniesRequisites(prisma, session);
  const companies = res.ok ? res.companies : [];

  const brandingByCompany: Record<string, BrandingSlotView[]> = Object.fromEntries(
    await Promise.all(
      companies.map(async (c) => {
        const branding = await listCompanyBranding(prisma, session, c.id);
        // Отказ по одной компании не роняет экран: слоты просто пустые.
        return [c.id, branding.ok ? branding.slots : []] as const;
      })
    )
  );

  return (
    <RequisitesScreen
      cabinet="leader"
      hasCompany={Boolean(session.companyId)}
      companies={companies}
      brandingByCompany={brandingByCompany}
    />
  );
}

import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCompaniesRequisites } from '@/lib/services/admin/companyRequisites';
import { RequisitesScreen } from '@/components/settings/requisites-screen';

export const metadata: Metadata = { title: 'Реквизиты исполнителя · Настройки' };

/**
 * «Реквизиты исполнителя» руководителя (`У-135`): только своя компания —
 * скоуп держит сервис, а не видимость карточки. Экран общий с админом;
 * база — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function LeaderRequisitesPage() {
  const session = await requireSettingsSection('catalogs.requisites', 'leader');
  const companies = await listCompaniesRequisites(prisma, session);

  return (
    <RequisitesScreen
      cabinet="leader"
      hasCompany={Boolean(session.companyId)}
      companies={companies.ok ? companies.companies : []}
    />
  );
}

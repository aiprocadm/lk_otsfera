import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCatalogItems } from '@/lib/services/admin/catalogItems';
import { listDirectionOptions } from '@/lib/services/training/directions';
import { PriceListScreen } from '@/components/settings/price-list-screen';

export const metadata: Metadata = { title: 'Каталог услуг и цены · Настройки' };

/**
 * «Каталог услуг и цены» руководителя (`У-136`): только своя компания —
 * границу держит сервис сравнением companyId, а не скрытый селект. Экран
 * общий с админом; база — здесь, в слое app: компонент презентационный
 * (`components-no-db`).
 */
export default async function LeaderPriceListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.priceList', 'leader');
  const params = await searchParams;
  const activeCompanyId = session.companyId ?? null;
  const q = params.q ?? '';
  const includeInactive = params.inactive === '1';

  // Без компании в сессии каталог не читаем вовсе: экран объяснит, что не так.
  const items = activeCompanyId
    ? await listCatalogItems(prisma, session, { companyId: activeCompanyId, q, includeInactive })
    : { ok: true as const, items: [] };
  const directions = await listDirectionOptions(prisma);

  return (
    <PriceListScreen
      cabinet="leader"
      hasCompany={Boolean(session.companyId)}
      companies={[]}
      activeCompanyId={activeCompanyId}
      items={items.ok ? items.items : []}
      directions={directions}
      q={q}
      includeInactive={includeInactive}
    />
  );
}

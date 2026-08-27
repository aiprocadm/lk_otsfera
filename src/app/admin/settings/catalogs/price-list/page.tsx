import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCatalogItems } from '@/lib/services/admin/catalogItems';
import { listCompanyOptions } from '@/lib/services/admin/orders';
import { listDirectionOptions } from '@/lib/services/training/directions';
import { PriceListScreen } from '@/components/settings/price-list-screen';

export const metadata: Metadata = { title: 'Каталог услуг и цены · Настройки' };

/**
 * Этап 5 ТЗ (`У-136`): каталог услуг и цен компании — админ видит все компании
 * и выбирает явно (`?company=`), по умолчанию первая по алфавиту. Граница
 * компании проверяется сервисом, а не селектом. База — здесь, в слое app:
 * компонент презентационный (`components-no-db`).
 */
export default async function AdminPriceListPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; q?: string; inactive?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.priceList', 'admin');
  const params = await searchParams;
  const companies = await listCompanyOptions(prisma);
  const activeCompanyId = params.company || companies[0]?.id || null;
  const q = params.q ?? '';
  const includeInactive = params.inactive === '1';

  // Пустая строка поиска для сервиса равна отсутствию фильтра (он делает trim).
  const items = activeCompanyId
    ? await listCatalogItems(prisma, session, { companyId: activeCompanyId, q, includeInactive })
    : { ok: true as const, items: [] };
  const directions = await listDirectionOptions(prisma);

  return (
    <PriceListScreen
      cabinet="admin"
      hasCompany
      companies={companies}
      activeCompanyId={activeCompanyId}
      items={items.ok ? items.items : []}
      directions={directions}
      q={q}
      includeInactive={includeInactive}
    />
  );
}

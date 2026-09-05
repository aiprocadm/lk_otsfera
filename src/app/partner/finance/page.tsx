import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { isPartnerAdmin } from '@/lib/auth/policy';
import { countStatements, getFinanceKpis, listStatements } from '@/lib/services/partner/finance';
import { StatCard } from '@/components/dashboard/stat-card';
import { CommissionStatementsList } from '@/components/partner/commission-statements-list';
import { ManualCalcForm } from '@/components/partner/manual-calc-form';
import { fmtMoney } from '@/lib/format';
import { ExportLink } from '@/components/ui/export-link';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
type SearchParams = { take?: string; skip?: string };

const DEFAULT_TAKE = 30;
const MAX_TAKE = 100;

/** Мусор в адресе (`?take=abc`, `?skip=-5`) — не ошибка, а «как по умолчанию». */
function parsePage(sp: SearchParams): { take: number; skip: number } {
  const take = Number(sp.take);
  const skip = Number(sp.skip);
  return {
    take: Number.isFinite(take) && take >= 1 ? Math.min(Math.floor(take), MAX_TAKE) : DEFAULT_TAKE,
    skip: Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0,
  };
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePartner();
  const sp = await searchParams;
  const { take, skip } = parsePage(sp);

  const { partnerId } = session;
  // `С-6` (хотфикс №5): раньше страница молча показывала 30 последних
  // отчётов — старые были только в выгрузке. Теперь список постраничный.
  const [kpis, statements, total] = await Promise.all([
    getFinanceKpis(prisma, partnerId),
    listStatements(prisma, { partnerId, skip, take }),
    countStatements(prisma, { partnerId }),
  ]);

  const canManage = isPartnerAdmin(session);

  return (
    <div className="space-y-6">
      {/* `У-13`/`У-175`: на телефоне шапка складывается в столбик — как у
          зеркального экрана заказчика; иначе кнопки выталкивают страницу за
          край экрана (обход §0 нашёл 405px против 390px). */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <PageHeader title="Финансы" subtitle="Комиссионные отчёты и выплаты" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `У-115`: выгрузка в Excel есть и у заказчика, и у партнёра —
              содержание разное (платежи против комиссии), кнопка одна. */}
          <ExportLink base="/api/partner/finance/export" />
          {canManage && <ManualCalcForm />}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
        <StatCard title="Заработано" value={fmtMoney(kpis.earnedTotal)} />
        <StatCard title="В обработке" value={fmtMoney(kpis.pendingTotal)} />
        <StatCard title="Выплачено" value={fmtMoney(kpis.paidTotal)} accent />
      </div>

      <CommissionStatementsList statements={statements} canManage={canManage} />
      <Paginator
        basePath="/partner/finance"
        searchParams={sp}
        take={take}
        skip={skip}
        total={total}
      />
    </div>
  );
}

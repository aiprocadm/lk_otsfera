import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/**
 * Старый адрес «Воронки продаж» менеджера (этап 6 ТЗ 13.10.2026, `У-312`,
 * `В-ПМ-3` по умолчанию (а), `Р-6-12`): воронка стала видом внутри «Лидов»,
 * пункт меню убран. Закладки и ссылки из писем не ведут в 404 — страница
 * говорит «раздел переехал» и даёт ссылку на новое место.
 *
 * Гарды прежние: флаг `sales_funnel` (выключен — 404, как и раньше) и
 * менеджерский контур.
 */
export default async function ManagerFunnelMovedPage() {
  if (!isFeatureEnabled('sales_funnel')) notFound();
  await requireManager();
  return (
    <div className="space-y-4">
      <PageHeader title="Воронка продаж" subtitle="Раздел переехал в «Лиды»." />
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <p className="text-sm text-gray-700">
          Воронка теперь — вид внутри раздела «Лиды»: переключатель «Список / Воронка» над списком.
          Стадии и перетаскивание карточек остались прежними.
        </p>
        <Link
          href="/manager/leads?view=funnel"
          className="inline-flex rounded-lg bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#EA580C]"
        >
          Открыть воронку в «Лидах»
        </Link>
      </div>
    </div>
  );
}

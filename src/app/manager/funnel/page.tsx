import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { FunnelMovedNotice } from '@/components/funnel/funnel-moved-notice';

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
  return <FunnelMovedNotice leadsHref="/manager/leads" />;
}

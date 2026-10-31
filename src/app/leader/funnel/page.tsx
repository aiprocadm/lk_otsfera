import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { FunnelMovedNotice } from '@/components/funnel/funnel-moved-notice';

export const dynamic = 'force-dynamic';

/**
 * Старый адрес «Воронки продаж» руководителя (этап 4 ТЗ 28.10.2026, `У-349`,
 * зеркало `У-312` менеджера): воронка стала видом внутри «Лидов», пункт меню
 * убран. Гарды прежние — флаг `sales_funnel` (выключен — 404) и контур
 * руководителя.
 */
export default async function LeaderFunnelMovedPage() {
  if (!isFeatureEnabled('sales_funnel')) notFound();
  await requireManagerLeader();
  return (
    <FunnelMovedNotice
      leadsHref="/leader/leads"
      note="Настройка стадий воронки — там же, под доской."
    />
  );
}

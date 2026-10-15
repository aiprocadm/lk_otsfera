import React from 'react';
import { StatCard } from '@/components/dashboard/stat-card';
import type { KpiData } from '@/lib/services/manager/dashboard';
import { ORDER_FOCUS_LABEL, orderFocusHref } from '@/lib/orders/focus';

/**
 * Плитки заказов на главной менеджера (этап 4 ТЗ 13.10.2026, `У-297`).
 *
 * Названия понятнее прежних («Активные заказы», «Требует внимания», «Срочные
 * дедлайны»), и каждая плитка ведёт в «Заказы» **со своим фильтром**: число на
 * плитке равно числу строк после перехода (`Р-4-3`). Разница «±N / 30д» убрана —
 * подпись была непонятна (`Р-4-5`).
 */
export function ManagerKpiGrid({ data }: { data: KpiData }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
      <StatCard
        title={ORDER_FOCUS_LABEL.active}
        value={data.activeOrders}
        href={orderFocusHref('active')}
      />
      <StatCard
        title={ORDER_FOCUS_LABEL.overdue}
        value={data.attentionCount}
        accent={data.attentionCount > 0}
        href={orderFocusHref('overdue')}
      />
      <StatCard
        title="Непрочитанные комментарии"
        value={data.unreadComments}
        href="/manager/messages"
      />
      <StatCard
        title={ORDER_FOCUS_LABEL.due_soon}
        value={data.urgentDeadlines}
        href={orderFocusHref('due_soon')}
      />
    </div>
  );
}

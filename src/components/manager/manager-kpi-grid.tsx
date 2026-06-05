import { StatCard } from '@/components/dashboard/stat-card';
import type { KpiData } from '@/lib/services/manager/dashboard';

function fmtDelta(delta: number): string {
  if (delta === 0) return '±0 / 30д';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta} / 30д`;
}

export function ManagerKpiGrid({ data }: { data: KpiData }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard
        title='Активные заказы'
        value={`${data.activeOrders} (${fmtDelta(data.activeOrdersDelta)})`}
      />
      <StatCard
        title='Требует внимания'
        value={data.attentionCount}
        accent={data.attentionCount > 0}
      />
      <StatCard title='Непрочитанные комментарии' value={data.unreadComments} />
      <StatCard title='Срочные дедлайны' value={data.urgentDeadlines} />
    </div>
  );
}

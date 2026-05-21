import type { Attention } from '@/lib/services/partner/dashboard';

export function AttentionList({ data }: { data: Attention }) {
  const empty =
    data.stuckOrders.length === 0 &&
    data.overdueOrders.length === 0 &&
    data.staleLeads.length === 0;

  if (empty) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Всё под контролем — ничего не зависло.
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Требует внимания</h2>
      <ul className='space-y-2 text-sm'>
        {data.stuckOrders.map((o) => (
          <li key={`stuck-${o.id}`} className='flex items-center justify-between gap-3'>
            <span className='text-gray-700'>🕒 Сделка «{o.title}» зависла</span>
            <span className='text-gray-400 text-xs'>обн. {o.updatedAt.toLocaleDateString('ru-RU')}</span>
          </li>
        ))}
        {data.overdueOrders.map((o) => (
          <li key={`overdue-${o.id}`} className='flex items-center justify-between gap-3'>
            <span className='text-red-700'>⚠ Просрочка: «{o.title}»</span>
            <span className='text-gray-400 text-xs'>до {o.deadline?.toLocaleDateString('ru-RU') ?? '—'}</span>
          </li>
        ))}
        {data.staleLeads.map((l) => (
          <li key={`lead-${l.id}`} className='flex items-center justify-between gap-3'>
            <span className='text-gray-700'>👤 Лид «{l.clientCompanyName}» без квалификации</span>
            <span className='text-gray-400 text-xs'>с {l.createdAt.toLocaleDateString('ru-RU')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

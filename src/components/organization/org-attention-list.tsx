import Link from 'next/link';
import type { OrgAttention, OrgAttentionItem } from '@/lib/services/organization/dashboard';

const kindIcon: Record<OrgAttentionItem['kind'], string> = {
  billed_unpaid: '💳',
  unsigned_act: '✍',
  completed_open: '✅'
};

export function OrgAttentionList({ data }: { data: OrgAttention }) {
  if (data.items.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Всё под контролем — ничего не требует вашего внимания.
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Требует внимания</h2>
      <ul className='space-y-2 text-sm'>
        {data.items.map((it) => (
          <li key={it.id} className='flex items-center justify-between gap-3'>
            <Link
              href={`/organization/orders/${it.orderId}`}
              className={`${
                it.severity === 'urgent' ? 'text-red-700' : 'text-gray-700'
              } hover:text-[#F97316] flex-1 min-w-0 truncate`}
            >
              <span className='mr-1'>{kindIcon[it.kind]}</span>
              {it.title}
            </Link>
            {it.meta ? (
              <span className='text-gray-400 text-xs whitespace-nowrap'>{it.meta}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

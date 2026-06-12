import Link from 'next/link';
import type { ManagerInboxItem } from '@/lib/services/manager/messages';
import { fmtDateTime } from '@/lib/format';

const EXCERPT_LEN = 200;

function excerpt(body: string): string {
  if (body.length <= EXCERPT_LEN) return body;
  return body.slice(0, EXCERPT_LEN).trimEnd() + '…';
}

function authorTone(role: string): { dot: string; label: string; badge: string } {
  if (role === 'organization') {
    return {
      dot: 'bg-blue-500',
      label: 'Организация',
      badge: 'bg-blue-50 text-blue-700 border-blue-200'
    };
  }
  if (role === 'manager') {
    return {
      dot: 'bg-[#F97316]',
      label: 'Менеджер',
      badge: 'bg-orange-50 text-orange-700 border-orange-200'
    };
  }
  return {
    dot: 'bg-gray-400',
    label: role,
    badge: 'bg-gray-50 text-gray-700 border-gray-200'
  };
}

function initials(name: string | null, email: string): string {
  const src = (name?.trim() || email).trim();
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

type Props = {
  rows: ManagerInboxItem[];
  nextCursor: string | null;
};

function buildNextHref(cursor: string): string {
  const params = new URLSearchParams();
  params.set('cursor', cursor);
  return `/manager/messages?${params.toString()}`;
}

export function ManagerMessagesInbox({ rows, nextCursor }: Props) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>✉️</span>
        </div>
        <p className='text-gray-500 text-sm'>Сообщений пока нет.</p>
      </div>
    );
  }

  // Group visually by orderNumber/orderId so a string of replies on the same
  // order doesn't repeat the order header. We keep the original (desc-by-id)
  // ordering — adjacent rows on the same order are grouped, non-adjacent
  // groupings still get their own header naturally.
  type Group = { orderId: string; orderNumber: string | null; orderTitle: string; items: ManagerInboxItem[] };
  const groups: Group[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.orderId === r.order.id) {
      last.items.push(r);
    } else {
      groups.push({
        orderId: r.order.id,
        orderNumber: r.order.orderNumber,
        orderTitle: r.order.title,
        items: [r]
      });
    }
  }

  return (
    <div className='space-y-4'>
      {groups.map((g) => (
        <div
          key={`${g.orderId}-${g.items[0]!.id}`}
          className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'
        >
          <div className='flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50'>
            <div className='flex items-baseline gap-2 min-w-0'>
              <span className='text-xs text-gray-500 whitespace-nowrap'>
                {g.orderNumber ?? '—'}
              </span>
              <Link
                href={`/manager/orders/${g.orderId}`}
                className='font-medium text-sm text-[#111111] hover:text-[#F97316] truncate'
              >
                {g.orderTitle}
              </Link>
            </div>
            <Link
              href={`/manager/orders/${g.orderId}`}
              className='text-[#F97316] hover:underline text-xs whitespace-nowrap'
            >
              Открыть заказ →
            </Link>
          </div>
          <ul className='divide-y divide-gray-50'>
            {g.items.map((c) => {
              const tone = authorTone(c.author.role);
              const displayName = c.author.name?.trim() || c.author.email;
              return (
                <li key={c.id} className='px-4 py-3 flex gap-3'>
                  <div className='flex-shrink-0'>
                    <div
                      className={`w-8 h-8 rounded-full ${tone.dot} text-white flex items-center justify-center text-xs font-semibold`}
                      aria-hidden='true'
                    >
                      {initials(c.author.name, c.author.email)}
                    </div>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 mb-1 flex-wrap'>
                      <span className='font-medium text-sm text-[#111111] truncate'>
                        {displayName}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${tone.badge}`}
                      >
                        {tone.label}
                      </span>
                      <span className='text-xs text-gray-400 ml-auto whitespace-nowrap'>
                        {fmtDateTime(new Date(c.createdAt))}
                      </span>
                    </div>
                    <p className='text-sm text-gray-700 whitespace-pre-wrap break-words'>
                      {excerpt(c.body)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {nextCursor && (
        <div className='flex justify-center'>
          <Link
            href={buildNextHref(nextCursor)}
            className='px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:border-[#F97316] hover:text-[#F97316]'
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}

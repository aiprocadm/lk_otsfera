import type { OrgOrderDetail } from '@/lib/services/organization/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';

export function OrgOrderHeader({ order }: { order: OrgOrderDetail }) {
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <div className='flex flex-col md:flex-row md:items-start md:justify-between gap-3'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-1'>
            {order.orderNumber && (
              <span className='text-xs text-gray-500 font-mono'>№ {order.orderNumber}</span>
            )}
            <DealStatusBadge stage={order.stage} />
          </div>
          <h1 className='text-2xl font-bold text-[#111111]'>{order.title}</h1>
        </div>
        {order.managerName && (
          <div className='text-right text-sm text-gray-500 md:min-w-[180px]'>
            <div className='text-[10px] uppercase tracking-wider text-gray-400'>Менеджер</div>
            <div className='font-medium text-[#111111]'>{order.managerName}</div>
          </div>
        )}
      </div>
      {order.productMix.length > 0 && (
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {order.productMix.map((p) => (
            <span key={p} className='text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded'>
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

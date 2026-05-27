import type { ManagerOrgDetail } from '@/lib/services/manager/organizations';

/**
 * Single-org overview card for the manager cabinet. Shape mirrors
 * `partner/org-card-header.tsx` but tuned to the manager scope: we only show
 * counters (orders / students / users) and the partner ref — no commission /
 * INN / KPP, which are partner-finance concerns the manager doesn't manage.
 */
export function ManagerOrgCard({ org }: { org: ManagerOrgDetail }) {
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <div className='flex flex-col md:flex-row md:items-start md:justify-between gap-4'>
        <div className='flex-1 min-w-0'>
          <h1 className='text-2xl font-bold text-[#111111]'>{org.name}</h1>
          {org.partner && (
            <div className='text-sm text-gray-500 mt-1'>
              Партнёр: <span className='text-[#111111]'>{org.partner.name}</span>
            </div>
          )}
        </div>
        <div className='grid grid-cols-3 gap-3 md:gap-4 md:min-w-[360px]'>
          <Tile label='Заказов' value={org._count.orders} />
          <Tile label='Сотрудников' value={org._count.students} />
          <Tile label='Пользователей' value={org._count.users} />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-lg border bg-gray-50 border-gray-100 p-3'>
      <div className='text-[10px] uppercase tracking-wider text-gray-500'>{label}</div>
      <div className='text-lg font-bold text-[#111111]'>{value}</div>
    </div>
  );
}

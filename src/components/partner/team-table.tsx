import type { TeamRow } from '@/lib/services/partner/team';
import { MemberRowActions } from './member-row-actions';

export function TeamTable({
  rows,
  orgs,
  currentUserId
}: {
  rows: TeamRow[];
  orgs: { id: string; name: string }[];
  currentUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>👥</span>
        </div>
        <p className='text-gray-500 text-sm'>В команде пока никого нет — пригласите первого сотрудника</p>
      </div>
    );
  }

  return (
    <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Сотрудник</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Email</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Роль</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Доступ к организациям</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600 w-32'></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.userId}
              className={`border-b border-gray-50 ${i === rows.length - 1 ? 'border-b-0' : ''} ${
                row.isActive ? 'hover:bg-[#FFF7ED]' : 'bg-gray-50/50 text-gray-400'
              }`}
            >
              <td className='px-4 py-2.5'>
                <div className={`font-medium ${row.isActive ? 'text-[#111111]' : 'text-gray-400'}`}>
                  {row.name}
                  {row.userId === currentUserId && (
                    <span className='ml-2 text-xs text-gray-400'>(вы)</span>
                  )}
                </div>
                {!row.isActive && <div className='text-xs text-gray-400'>деактивирован</div>}
              </td>
              <td className='px-4 py-2.5 text-gray-500'>{row.email}</td>
              <td className='px-4 py-2.5'>
                <RoleBadge role={row.roleInPartner} active={row.isActive} />
              </td>
              <td className='px-4 py-2.5 text-gray-500'>
                <ScopeSummary assignedOrgIds={row.assignedOrgIds} orgs={orgs} />
              </td>
              <td className='px-4 py-2.5 text-right'>
                {row.isActive && row.userId !== currentUserId && (
                  <MemberRowActions
                    userId={row.userId}
                    name={row.name}
                    initialAssignedOrgIds={row.assignedOrgIds}
                    orgs={orgs}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleBadge({ role, active }: { role: 'admin' | 'manager'; active: boolean }) {
  if (!active) {
    return <span className='text-xs text-gray-400'>—</span>;
  }
  return role === 'admin' ? (
    <span className='inline-flex items-center px-2 py-0.5 bg-[#FFF7ED] text-[#9A3412] text-xs font-medium rounded'>
      Админ
    </span>
  ) : (
    <span className='inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-medium rounded'>
      Менеджер
    </span>
  );
}

function ScopeSummary({
  assignedOrgIds,
  orgs
}: {
  assignedOrgIds: string[];
  orgs: { id: string; name: string }[];
}) {
  if (assignedOrgIds.length === 0) {
    return <span className='text-xs text-gray-500'>Все организации</span>;
  }
  if (assignedOrgIds.length <= 2) {
    const names = assignedOrgIds
      .map((id) => orgs.find((o) => o.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    return <span className='text-xs'>{names || '—'}</span>;
  }
  return (
    <span className='text-xs'>
      {assignedOrgIds.length} {assignedOrgIds.length < 5 ? 'организации' : 'организаций'}
    </span>
  );
}

import {
  updateOrgMemberRoleFormAction,
  deactivateOrgMemberFormAction,
  reactivateOrgMemberFormAction
} from '@/server-actions/organization/team';
import type { OrgMemberRow } from '@/lib/services/organization/team';

type Props = {
  members: OrgMemberRow[];
  organizationId: string;
  currentUserId: string;
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

export function TeamTable({ members, organizationId, currentUserId }: Props) {
  if (members.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <p className='text-gray-500 text-sm'>
          В команде пока нет участников. Пригласите первого администратора через
          форму выше.
        </p>
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>ФИО</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Email</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Роль</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Статус</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Приглашён</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Действия</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => {
            const isSelf = m.userId === currentUserId;
            const targetRole = m.roleInOrg === 'admin' ? 'member' : 'admin';
            return (
              <tr
                key={m.organizationUserId}
                className={`border-b border-gray-50 ${i === members.length - 1 ? 'border-b-0' : ''} ${
                  !m.isActive ? 'bg-gray-50/50 text-gray-400' : 'hover:bg-[#FFF7ED]'
                }`}
              >
                <td className='px-4 py-2.5 font-medium'>
                  {m.name}
                  {isSelf && (
                    <span className='ml-2 text-xs text-gray-400'>(это вы)</span>
                  )}
                </td>
                <td className='px-4 py-2.5'>{m.email}</td>
                <td className='px-4 py-2.5'>
                  {m.roleInOrg === 'admin' ? 'Администратор' : 'Сотрудник'}
                </td>
                <td className='px-4 py-2.5'>
                  {m.isActive ? (
                    <span className='inline-flex items-center gap-1 text-green-700 text-xs'>
                      <span className='w-1.5 h-1.5 rounded-full bg-green-500' />
                      Активен
                    </span>
                  ) : (
                    <span className='inline-flex items-center gap-1 text-gray-500 text-xs'>
                      <span className='w-1.5 h-1.5 rounded-full bg-gray-400' />
                      Деактивирован
                    </span>
                  )}
                </td>
                <td className='px-4 py-2.5 text-gray-500'>{fmtDate(m.invitedAt)}</td>
                <td className='px-4 py-2.5 text-right'>
                  {isSelf ? (
                    <span className='text-xs text-gray-400'>—</span>
                  ) : (
                    <div className='inline-flex gap-2'>
                      {m.isActive && (
                        <form action={updateOrgMemberRoleFormAction}>
                          <input type='hidden' name='organizationId' value={organizationId} />
                          <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                          <input type='hidden' name='newRole' value={targetRole} />
                          <button
                            type='submit'
                            className='px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50'
                          >
                            {targetRole === 'admin' ? 'Сделать админом' : 'Сделать сотрудником'}
                          </button>
                        </form>
                      )}
                      {m.isActive ? (
                        <form action={deactivateOrgMemberFormAction}>
                          <input type='hidden' name='organizationId' value={organizationId} />
                          <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                          <button
                            type='submit'
                            className='px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50'
                          >
                            Деактивировать
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateOrgMemberFormAction}>
                          <input type='hidden' name='organizationId' value={organizationId} />
                          <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                          <button
                            type='submit'
                            className='px-2 py-1 text-xs text-green-700 border border-green-200 rounded hover:bg-green-50'
                          >
                            Возобновить
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

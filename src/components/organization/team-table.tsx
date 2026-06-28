import {
  updateOrgMemberRoleFormAction,
  deactivateOrgMemberFormAction,
  reactivateOrgMemberFormAction
} from '@/server-actions/organization/team';
import type { OrgMemberRow } from '@/lib/services/organization/team';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';

type Props = {
  members: OrgMemberRow[];
  organizationId: string;
  currentUserId: string;
  viewerRole: 'admin' | 'leader' | 'member';
};

const ROLE_LABELS: Record<'admin' | 'leader' | 'member', string> = {
  admin: 'Администратор',
  leader: 'Руководитель',
  member: 'Сотрудник'
};

export function TeamTable({ members, organizationId, currentUserId, viewerRole }: Props) {
  if (members.length === 0) {
    return (
      <EmptyState message='В команде пока нет участников. Пригласите первого администратора через форму выше.' />
    );
  }

  return (
    <TableShell>
      <THead>
        <Th>ФИО</Th>
        <Th>Email</Th>
        <Th>Роль</Th>
        <Th>Статус</Th>
        <Th>Приглашён</Th>
        <Th className='text-right'>Действия</Th>
      </THead>
      <tbody>
        {members.map((m) => {
          const isSelf = m.userId === currentUserId;
          // A leader may manage only member/leader rows; admin may manage anyone.
          const canManageTarget = viewerRole === 'admin' || m.roleInOrg !== 'admin';
          return (
            <Tr
              key={m.organizationUserId}
              hover={m.isActive}
              className={m.isActive ? undefined : 'bg-gray-50/50 text-gray-400'}
            >
              <Td className='font-medium'>
                {m.name}
                {isSelf && <span className='ml-2 text-xs text-gray-400'>(это вы)</span>}
              </Td>
              <Td>{m.email}</Td>
              <Td>{ROLE_LABELS[m.roleInOrg]}</Td>
              <Td>
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
              </Td>
              <Td className='text-gray-500'>{fmtDate(m.invitedAt)}</Td>
              <Td className='text-right'>
                {isSelf || !canManageTarget ? (
                  <span className='text-xs text-gray-400'>—</span>
                ) : (
                  <div className='inline-flex items-center gap-2'>
                    {m.isActive && (
                      <form action={updateOrgMemberRoleFormAction} className='inline-flex items-center gap-1'>
                        <input type='hidden' name='organizationId' value={organizationId} />
                        <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                        <select
                          name='newRole'
                          defaultValue={m.roleInOrg}
                          className='text-xs border border-gray-200 rounded px-1.5 py-1 bg-white'
                        >
                          <option value='member'>Сотрудник</option>
                          <option value='leader'>Руководитель</option>
                          {viewerRole === 'admin' && <option value='admin'>Администратор</option>}
                        </select>
                        <button type='submit' className='px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50'>
                          Применить
                        </button>
                      </form>
                    )}
                    {m.isActive ? (
                      <form action={deactivateOrgMemberFormAction}>
                        <input type='hidden' name='organizationId' value={organizationId} />
                        <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                        <button type='submit' className='px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50'>
                          Деактивировать
                        </button>
                      </form>
                    ) : (
                      <form action={reactivateOrgMemberFormAction}>
                        <input type='hidden' name='organizationId' value={organizationId} />
                        <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                        <button type='submit' className='px-2 py-1 text-xs text-green-700 border border-green-200 rounded hover:bg-green-50'>
                          Возобновить
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

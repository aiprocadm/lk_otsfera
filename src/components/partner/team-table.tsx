import React from 'react';
import type { TeamRow } from '@/lib/services/partner/team';
import { MemberRowActions } from './member-row-actions';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { InviteResendButtons } from '@/components/team/invite-resend-buttons';
import { fmtLastLogin } from '@/lib/format';

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
      <EmptyState icon='👥' message='В команде пока никого нет — пригласите первого сотрудника' />
    );
  }

  return (
    <TableShell className='hidden md:block'>
      <THead>
        <Th>Сотрудник</Th>
        <Th>Email</Th>
        <Th>Роль</Th>
        <Th>Доступ к организациям</Th>
        <Th>Последний вход</Th>
        <Th className='w-32'></Th>
      </THead>
      <tbody>
        {rows.map((row) => (
          <Tr
            key={row.userId}
            hover={row.isActive}
            className={row.isActive ? undefined : 'bg-gray-50/50 text-gray-400'}
          >
            <Td>
              <div className={`font-medium ${row.isActive ? 'text-[#111111]' : 'text-gray-400'}`}>
                {row.name}
                {row.userId === currentUserId && (
                  <span className='ml-2 text-xs text-gray-400'>(вы)</span>
                )}
              </div>
              {!row.isActive && <div className='text-xs text-gray-400'>деактивирован</div>}
            </Td>
            <Td className='text-gray-500'>
              {row.email}
              {row.isActive && row.invitePending && (
                <div className='mt-0.5'>
                  <span className='text-xs text-amber-700'>Ожидает установки пароля</span>
                  {row.userId !== currentUserId && (
                    <div className='mt-0.5'>
                      <InviteResendButtons userId={row.userId} />
                    </div>
                  )}
                </div>
              )}
            </Td>
            <Td>
              <RoleBadge role={row.roleInPartner} active={row.isActive} />
            </Td>
            <Td className='text-gray-500'>
              <ScopeSummary assignedOrgIds={row.assignedOrgIds} orgs={orgs} />
            </Td>
            <Td className='text-gray-500 text-xs'>{fmtLastLogin(row.lastLoginAt)}</Td>
            <Td className='text-right'>
              {row.isActive && row.userId !== currentUserId && (
                <MemberRowActions
                  userId={row.userId}
                  name={row.name}
                  initialAssignedOrgIds={row.assignedOrgIds}
                  orgs={orgs}
                />
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
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

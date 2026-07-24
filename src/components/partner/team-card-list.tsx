import React from 'react';
import type { TeamRow } from '@/lib/services/partner/team';
import { MemberRowActions } from './member-row-actions';
import { InviteResendButtons } from '@/components/team/invite-resend-buttons';

export function TeamCardList({
  rows,
  orgs,
  currentUserId
}: {
  rows: TeamRow[];
  orgs: { id: string; name: string }[];
  currentUserId: string;
}) {
  if (rows.length === 0) return null;

  return (
    <ul className='md:hidden space-y-2'>
      {rows.map((row) => (
        <li
          key={row.userId}
          className={`bg-white border border-gray-200 rounded-xl p-4 ${
            !row.isActive ? 'opacity-60' : ''
          }`}
        >
          <div className='flex items-start justify-between gap-2'>
            <div className='flex-1 min-w-0'>
              <div className='font-medium text-[#111111] truncate'>
                {row.name}
                {row.userId === currentUserId && (
                  <span className='ml-2 text-xs text-gray-400 font-normal'>(вы)</span>
                )}
              </div>
              <div className='text-xs text-gray-500 truncate'>{row.email}</div>
            </div>
            {row.isActive ? (
              <RoleBadge role={row.roleInPartner} />
            ) : (
              <span className='text-xs text-gray-400 flex-shrink-0'>деактивирован</span>
            )}
          </div>

          <div className='mt-2 text-xs text-gray-500'>
            <ScopeSummary assignedOrgIds={row.assignedOrgIds} orgs={orgs} />
          </div>

          {row.isActive && row.invitePending && (
            <div className='mt-2'>
              <span className='text-xs text-amber-700'>Ожидает установки пароля</span>
              {row.userId !== currentUserId && (
                <div className='mt-0.5'>
                  <InviteResendButtons userId={row.userId} />
                </div>
              )}
            </div>
          )}

          {row.isActive && row.userId !== currentUserId && (
            <div className='mt-3 flex justify-end'>
              <MemberRowActions
                userId={row.userId}
                name={row.name}
                initialAssignedOrgIds={row.assignedOrgIds}
                orgs={orgs}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function RoleBadge({ role }: { role: 'admin' | 'manager' }) {
  return role === 'admin' ? (
    <span className='inline-flex items-center px-2 py-0.5 bg-[#FFF7ED] text-[#9A3412] text-xs font-medium rounded flex-shrink-0'>
      Админ
    </span>
  ) : (
    <span className='inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-medium rounded flex-shrink-0'>
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
    return <>Доступ: все организации</>;
  }
  if (assignedOrgIds.length <= 2) {
    const names = assignedOrgIds
      .map((id) => orgs.find((o) => o.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    return <>Доступ: {names || '—'}</>;
  }
  return (
    <>
      Доступ: {assignedOrgIds.length}{' '}
      {assignedOrgIds.length < 5 ? 'организации' : 'организаций'}
    </>
  );
}

import React from 'react';
import Link from 'next/link';
import {
  deactivateUserFormAction,
  reactivateUserFormAction
} from '@/server-actions/admin/users';
import type { UserRow } from '@/lib/services/admin/users';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { InviteResendButtons } from '@/components/team/invite-resend-buttons';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация',
  student: 'Студент'
};

export function UsersTable({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
  if (rows.length === 0) {
    return <EmptyState message='Пользователей не найдено' className='p-8' />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Email</Th>
        <Th>Имя</Th>
        <Th>Роль</Th>
        <Th>Привязка</Th>
        <Th>Активен</Th>
        <Th>Создан</Th>
        <Th className='text-right'>Действия</Th>
      </THead>
      <tbody>
        {rows.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <Tr key={u.id}>
              <Td className='font-mono text-xs text-[#111111]'>{u.email}</Td>
              <Td>{u.name}</Td>
              <Td className='text-gray-600'>{ROLE_LABELS[u.role] ?? u.role}</Td>
              <Td className='text-gray-600'>{u.attachmentLabel}</Td>
              <Td>
                {u.isActive ? (
                  <span className='text-green-600 text-xs'>●</span>
                ) : (
                  <span className='text-gray-300 text-xs'>●</span>
                )}
                {u.isActive && u.invitePending && (
                  <div className='mt-0.5'>
                    <span className='text-xs text-amber-700 whitespace-nowrap'>Ожидает пароль</span>
                    {u.id !== currentUserId && (
                      <div className='mt-0.5'>
                        <InviteResendButtons userId={u.id} />
                      </div>
                    )}
                  </div>
                )}
              </Td>
              <Td className='text-gray-500 text-xs'>
                {new Intl.DateTimeFormat('ru-RU').format(u.createdAt)}
              </Td>
              <Td className='text-right'>
                <div className='flex items-center justify-end gap-2'>
                  <Link href={`/admin/users/${u.id}`} className='text-[#F97316] text-xs hover:underline'>
                    Редактировать
                  </Link>
                  {!isSelf && (
                    u.isActive ? (
                      <form action={deactivateUserFormAction}>
                        <input type='hidden' name='id' value={u.id} />
                        <button type='submit' className='text-gray-500 text-xs hover:text-red-600'>
                          Деактивировать
                        </button>
                      </form>
                    ) : (
                      <form action={reactivateUserFormAction}>
                        <input type='hidden' name='id' value={u.id} />
                        <button type='submit' className='text-gray-500 text-xs hover:text-green-600'>
                          Восстановить
                        </button>
                      </form>
                    )
                  )}
                </div>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

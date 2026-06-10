import React from 'react';
import Link from 'next/link';
import {
  deactivateUserFormAction,
  reactivateUserFormAction
} from '@/server-actions/admin/users';
import type { UserRow } from '@/lib/services/admin/users';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация',
  student: 'Студент'
};

export function UsersTable({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
        Пользователей не найдено
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Email</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Имя</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Роль</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Привязка</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Активен</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Создан</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-[#FFF7ED]">
                <td className="px-4 py-2.5 font-mono text-xs text-[#111111]">{u.email}</td>
                <td className="px-4 py-2.5">{u.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{ROLE_LABELS[u.role] ?? u.role}</td>
                <td className="px-4 py-2.5 text-gray-600">{u.attachmentLabel}</td>
                <td className="px-4 py-2.5">
                  {u.isActive ? (
                    <span className="text-green-600 text-xs">●</span>
                  ) : (
                    <span className="text-gray-300 text-xs">●</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {new Intl.DateTimeFormat('ru-RU').format(u.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link href={`/admin/users/${u.id}`} className="text-[#F97316] text-xs hover:underline">
                      Редактировать
                    </Link>
                    {!isSelf && (
                      u.isActive ? (
                        <form action={deactivateUserFormAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <button type="submit" className="text-gray-500 text-xs hover:text-red-600">
                            Деактивировать
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateUserFormAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <button type="submit" className="text-gray-500 text-xs hover:text-green-600">
                            Восстановить
                          </button>
                        </form>
                      )
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

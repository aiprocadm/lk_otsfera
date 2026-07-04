'use client';

import React, { useState } from 'react';
import { updateUserAction } from '@/server-actions/admin/users';
import { useFormAction } from '@/lib/ui/useFormAction';
import type { UserDetail } from '@/lib/services/admin/users';

type Partner = { id: string; name: string };

const ROLE_LABELS_RU: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация',
  student: 'Студент'
};

function allowedRoles(currentRole: string): string[] {
  if (currentRole === 'partner') return ['partner', 'student'];
  if (currentRole === 'student') return ['student', 'partner'];
  if (currentRole === 'organization') return ['organization'];
  if (currentRole === 'manager') return ['manager'];
  return [currentRole];
}

const ERROR_MAP: Record<string, string> = {
  duplicate_email: 'Пользователь с таким email уже существует.',
  admin_role_via_ui: 'Создание admin через UI недоступно.',
  self_action_forbidden: 'Нельзя менять собственную роль или деактивировать себя.',
  last_admin_protected: "Нельзя деактивировать последнего активного admin'а.",
  role_transition_forbidden: 'Этот переход роли не поддерживается. Деактивируйте пользователя и создайте нового.',
  validation: 'Проверьте корректность полей.',
  not_found: 'Пользователь не найден.'
};

export function UserEditForm({ user, partners, isSelf }: { user: UserDetail; partners: Partner[]; isSelf: boolean }) {
  const { formAction, pending, errorText, success } = useFormAction<object>({
    action: updateUserAction,
    errorMap: ERROR_MAP
  });
  const [role, setRole] = useState<string>(user.role);
  const [partnerId, setPartnerId] = useState<string>(user.partnerId ?? '');
  const [name, setName] = useState(user.name);
  const [isActive, setIsActive] = useState(user.isActive);

  const roleOptions = allowedRoles(user.role);

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-6 max-w-xl">
      <input type="hidden" name="id" value={user.id} />

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Email</label>
        <input type="email" value={user.email} readOnly
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-gray-50 text-gray-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Имя</label>
        <input type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]" />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Роль</label>
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)}
          disabled={roleOptions.length === 1 || isSelf}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:bg-gray-50">
          {roleOptions.map((r) => (
            // Defensive fallback: `r` is always a key of ROLE_LABELS_RU today (allowedRoles()
            // only returns values from the Role enum, which the map fully covers), so the
            // `?? r` side is unreachable unless the enum gains a role without a matching label.
            /* v8 ignore next */
            <option key={r} value={r}>{ROLE_LABELS_RU[r] ?? r}</option>
          ))}
        </select>
        {roleOptions.length === 1 && (
          <p className="text-xs text-gray-500 mt-1">
            Переход роли для этого пользователя не поддерживается через UI.
          </p>
        )}
      </div>

      {role === 'partner' && (
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Партнёр</label>
          <select name="partnerId" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]">
            <option value="">— выберите —</option>
            {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
      )}

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-[#111111]">
          <input type="checkbox" checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isSelf}
            className="rounded" />
          Активен
        </label>
        <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
        {isSelf && (
          <p className="text-xs text-gray-500 mt-1">Нельзя деактивировать себя.</p>
        )}
      </div>

      <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
        Привязки к организациям управляются на странице организации.
      </div>

      {errorText && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{errorText}</div>
      )}
      {success && (
        <div role="status" className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">
          Изменения сохранены.
        </div>
      )}

      <button type="submit" disabled={pending}
        className="px-4 py-2 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C] disabled:opacity-60">
        {pending ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </form>
  );
}

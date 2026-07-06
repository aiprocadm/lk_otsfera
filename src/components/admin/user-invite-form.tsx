'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserAction } from '@/server-actions/admin/users';
import { useFormAction } from '@/lib/ui/useFormAction';

type Partner = { id: string; name: string };

export function UserInviteForm({ partners }: { partners: Partner[] }) {
  const router = useRouter();
  // Коды ошибок локализуются централизованно через errorMessageRu (см. useFormAction);
  // admin-специфичные коды (duplicate_email/admin_role_via_ui) живут в lib/errors/messages.
  const { formAction, pending, errorText, data } = useFormAction<{
    user: { id: string; email: string };
    inviteUrl: string;
  }>({ action: createUserAction });
  const inviteUrl = data?.inviteUrl ?? null;
  const [role, setRole] = useState<'organization' | 'partner' | 'manager' | 'student'>('organization');

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-6 max-w-xl">
      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Email</label>
        <input type="email" name="email" required
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]" />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Имя</label>
        <input type="text" name="name" required
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]" />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Роль</label>
        <select name="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]">
          <option value="organization">Организация</option>
          <option value="partner">Партнёр</option>
          <option value="manager">Менеджер</option>
          <option value="student">Студент</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">Создание admin&apos;а через UI недоступно.</p>
      </div>
      {role === 'partner' && (
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Партнёр</label>
          <select name="partnerId" required
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]">
            <option value="">— выберите —</option>
            {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
      )}
      {errorText && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{errorText}</div>
      )}
      {inviteUrl && (
        <div role="status" className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">
          Приглашение создано. Если email не дошёл, скопируйте ссылку:
          <input type="text" readOnly value={inviteUrl}
            className="w-full mt-2 border border-green-200 rounded px-2 py-1 font-mono text-xs"
            onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => router.push('/admin/users')}
            className="mt-3 px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50">
            К списку
          </button>
        </div>
      )}
      {!inviteUrl && (
        <button type="submit" disabled={pending}
          className="px-4 py-2 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C] disabled:opacity-60">
          {pending ? 'Создаю…' : 'Пригласить'}
        </button>
      )}
    </form>
  );
}

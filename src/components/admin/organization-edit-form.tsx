'use client';

import { useState } from 'react';
import { updateOrganizationAction } from '@/server-actions/admin/organizations';
import { useFormAction } from '@/lib/ui/useFormAction';
import type { OrgDetail } from '@/lib/services/admin/organizations';

type Props = { org: OrgDetail };

const ERROR_MAP: Record<string, string> = {
  not_found: 'Организация не найдена.',
  validation: 'Проверьте корректность полей.'
};

export function OrganizationEditForm({ org }: Props) {
  const { formAction, pending, errorText, success } = useFormAction<object>({
    action: updateOrganizationAction,
    errorMap: ERROR_MAP
  });
  const [name, setName] = useState(org.name);
  const [inn, setInn] = useState(org.inn ?? '');
  const [kpp, setKpp] = useState(org.kpp ?? '');

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-6 max-w-xl">
      <input type="hidden" name="id" value={org.id} />

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Название</label>
        <input
          type="text" name="name" value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={200}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">ИНН</label>
        <input
          type="text" name="inn" value={inn} onChange={(e) => setInn(e.target.value)}
          maxLength={20}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">КПП</label>
        <input
          type="text" name="kpp" value={kpp} onChange={(e) => setKpp(e.target.value)}
          maxLength={20}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Код 1С (из 1С)</label>
        <input
          type="text" value={org.externalId ?? '—'} readOnly
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-gray-50 text-gray-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Партнёр</label>
        <input
          type="text" value={org.partner?.name ?? 'Без партнёра'} readOnly
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-gray-50 text-gray-500"
        />
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

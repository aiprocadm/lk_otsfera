'use client';

import React, { useState } from 'react';
import { updatePartnerAction } from '@/server-actions/admin/partners';
import { useFormAction } from '@/lib/ui/useFormAction';
import type { PartnerDetail } from '@/lib/services/admin/partners';

const ERROR_MAP: Record<string, string> = {
  validation: 'Проверьте корректность полей.',
  not_found: 'Партнёр не найден.'
};

export function PartnerEditForm({ partner }: { partner: PartnerDetail }) {
  const { formAction, pending, errorText, success } = useFormAction<object>({
    action: updatePartnerAction,
    errorMap: ERROR_MAP
  });
  const [name, setName] = useState(partner.name);
  const [commissionRate, setCommissionRate] = useState<string>(
    partner.commissionRate != null ? String(partner.commissionRate * 100) : ''
  );
  const [isActive, setIsActive] = useState(partner.isActive);

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-6 max-w-xl">
      <input type="hidden" name="id" value={partner.id} />

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Slug</label>
        <input
          type="text"
          value={partner.slug}
          readOnly
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-gray-50 text-gray-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Название</label>
        <input
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Комиссия (%)</label>
        <input
          type="number"
          name="commissionRate"
          value={commissionRate}
          onChange={(e) => setCommissionRate(e.target.value)}
          min={0}
          max={100}
          step={0.01}
          placeholder="Например: 5"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
        <p className="text-xs text-gray-500 mt-1">Оставьте пустым, чтобы сбросить ставку.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Дата вступления ставки</label>
        <input
          type="date"
          name="effectiveFrom"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
        <p className="text-xs text-gray-500 mt-1">Оставьте пустым — ставка вступит с текущего момента.</p>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-[#111111]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded"
          />
          Активен
        </label>
        <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
      </div>

      {errorText && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{errorText}</div>
      )}
      {success && (
        <div role="status" className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">
          Изменения сохранены.
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C] disabled:opacity-60"
      >
        {pending ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </form>
  );
}

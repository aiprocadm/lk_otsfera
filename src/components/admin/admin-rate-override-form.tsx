'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setOrgRateOverrideAction } from '@/server-actions/admin/organizations';

function translateRateError(code: string): string {
  switch (code) {
    case 'rate_out_of_range': return 'Ставка должна быть строго между 0 и 100%.';
    case 'not_found': return 'Организация не найдена.';
    case 'validation': return 'Проверьте корректность полей.';
    default: return `Ошибка: ${code}`;
  }
}

export function AdminRateOverrideForm({
  organizationId,
  initialRate,
  initialNote
}: {
  organizationId: string;
  initialRate: number | null;
  initialNote: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ratePercent, setRatePercent] = useState<string>(
    initialRate !== null ? (initialRate * 100).toFixed(2) : ''
  );
  const [reason, setReason] = useState<string>(initialNote ?? '');

  function submit(action: 'set' | 'clear') {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('organizationId', organizationId);
      fd.set('reason', reason || (action === 'clear' ? 'Возврат к базовой ставке' : ''));
      if (action === 'set') fd.set('ratePercent', ratePercent);
      if (action === 'clear') fd.set('clear', 'true');

      const result = await setOrgRateOverrideAction(fd);
      if (result.ok) {
        router.refresh();
      } else {
        setError(translateRateError(result.error));
      }
    });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[#111111]">Ставка комиссии партнёра для этой организации</h2>

      <label className="block">
        <span className="text-sm text-gray-700">Ставка, %</span>
        <input
          type="number" step="0.01" min="0.01" max="99.99"
          value={ratePercent}
          onChange={(e) => setRatePercent(e.target.value)}
          placeholder="напр. 8.00"
          className="mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-48 focus:outline-none focus:border-[#F97316]"
        />
      </label>

      <label className="block">
        <span className="text-sm text-gray-700">Обоснование (audit log)</span>
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)}
          rows={2} placeholder="Например: VIP-клиент, индивидуальные условия"
          className="mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]"
        />
      </label>

      {error && <div role="alert" className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</div>}

      <div className="flex gap-2">
        <button
          type="button" onClick={() => submit('set')}
          disabled={pending || !ratePercent || !reason.trim()}
          className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >Сохранить</button>
        {initialRate !== null && (
          <button
            type="button" onClick={() => submit('clear')} disabled={pending}
            className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >Вернуть базовую ставку</button>
        )}
      </div>
    </div>
  );
}

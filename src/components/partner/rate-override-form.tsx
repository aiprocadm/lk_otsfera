'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessageRu } from '@/lib/errors/messages';

export function RateOverrideForm({
  orgId,
  initialRate,
  initialNote
}: { orgId: string; initialRate: string | null; initialNote: string | null }) {
  const router = useRouter();
  const [rate, setRate] = useState<string>(initialRate ? (Number(initialRate) * 100).toFixed(2) : '');
  const [reason, setReason] = useState<string>(initialNote ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'set' | 'clear') {
    setError(null);
    setSubmitting(true);
    try {
      const payload =
        action === 'clear'
          ? { rate: null, reason: reason || 'Возврат к базовой ставке' }
          : { rate: Number(rate) / 100, reason };

      const res = await fetch(`/api/partner/portfolio/${orgId}/rate`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body.error === 'string'
            ? errorMessageRu(body.error, 'Не удалось сохранить ставку. Попробуйте ещё раз.')
            : 'Не удалось сохранить ставку. Попробуйте ещё раз.'
        );
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <h2 className='text-sm font-semibold text-[#111111]'>Ставка комиссии партнёра для этой организации</h2>

      <label className='block'>
        <span className='text-sm text-gray-700'>Ставка, %</span>
        <input
          type='number'
          step='0.01'
          min='0.01'
          max='99.99'
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-48 focus:outline-none focus:border-[#F97316]'
          placeholder='напр. 8.00'
        />
      </label>

      <label className='block'>
        <span className='text-sm text-gray-700'>Обоснование (audit log)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
          placeholder='Например: VIP-клиент, индивидуальные условия'
        />
      </label>

      {error && <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>{error}</div>}

      <div className='flex gap-2'>
        <button
          type='button'
          onClick={() => submit('set')}
          disabled={submitting || !rate || !reason.trim()}
          className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        >
          Сохранить
        </button>
        {initialRate !== null && (
          <button
            type='button'
            onClick={() => submit('clear')}
            disabled={submitting}
            className='px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50'
          >
            Вернуть базовую ставку
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  statementId: string;
  status: string;
};

export function MarkPaidForm({ statementId, status }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (status !== 'approved') {
    return (
      <div className='text-xs text-gray-400 italic'>
        {status === 'paid'
          ? 'Уже отмечен как выплачен.'
          : `Доступно только для статуса approved (сейчас: ${status}).`}
      </div>
    );
  }

  function handleMarkPaid() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/partner/finance/statements/${statementId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'markPaid' }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Ошибка ${res.status}`);
    });
  }

  return (
    <div>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className='px-4 py-2 text-sm rounded-lg bg-[#F97316] text-white font-medium hover:bg-[#EA580C] transition-colors'
        >
          Отметить как выплачено
        </button>
      )}
      {open && (
        <div className='border border-gray-200 rounded-xl p-4 bg-white space-y-3'>
          <div className='text-sm text-gray-700'>
            Подтвердите, что комиссия по этому отчёту фактически переведена партнёру.
            Действие необратимо: статус сменится с <strong>approved</strong> на <strong>paid</strong>,
            а в audit log появится запись с вашим userId.
          </div>
          {error && (
            <div className='text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2'>
              {error}
            </div>
          )}
          <div className='flex items-center gap-2'>
            <button
              onClick={handleMarkPaid}
              disabled={isPending}
              className='px-4 py-2 text-sm rounded-lg bg-[#F97316] text-white font-medium hover:bg-[#EA580C] disabled:opacity-50 transition-colors'
            >
              {isPending ? 'Отмечаю…' : 'Да, отметить выплаченным'}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={isPending}
              className='px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50'
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

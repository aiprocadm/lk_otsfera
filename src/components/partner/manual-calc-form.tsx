'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ManualCalcForm() {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!month) { setError('Выберите месяц'); return; }

    const [year, mon] = month.split('-').map(Number);
    const periodFrom = new Date(year, mon - 1, 1).toISOString();
    const periodTo = new Date(year, mon, 0, 23, 59, 59, 999).toISOString();

    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/partner/finance/statements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodFrom, periodTo })
      });
      if (res.ok) {
        setOpen(false);
        setMonth('');
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Ошибка ${res.status}`);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] transition-colors'
      >
        Сформировать за период
      </button>

      {open && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <div className='bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4'>
            <div className='flex items-center justify-between'>
              <h2 className='text-lg font-semibold text-[#111111]'>Расчёт комиссии</h2>
              <button
                onClick={() => { setOpen(false); setError(null); }}
                className='text-gray-400 hover:text-gray-600 text-xl leading-none'
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-1'>
                  Период (месяц)
                </label>
                <input
                  type='month'
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  max={new Date().toISOString().slice(0, 7)}
                  className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent'
                  required
                />
              </div>

              {error && (
                <p className='text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2'>{error}</p>
              )}

              <div className='flex gap-3'>
                <button
                  type='button'
                  onClick={() => { setOpen(false); setError(null); }}
                  className='flex-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 transition-colors'
                >
                  Отмена
                </button>
                <button
                  type='submit'
                  disabled={isPending}
                  className='flex-1 px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 transition-colors'
                >
                  {isPending ? 'Считаю…' : 'Сформировать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

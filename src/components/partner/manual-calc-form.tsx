'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

export function ManualCalcForm() {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState('');

  const { formAction, pending, errorText, reset } = useFetchSubmit({
    url: '/api/partner/finance/statements',
    body: () => {
      const [year, mon] = month.split('-').map(Number);
      return {
        periodFrom: new Date(year, mon - 1, 1).toISOString(),
        periodTo: new Date(year, mon, 0, 23, 59, 59, 999).toISOString()
      };
    },
    onSuccess: () => {
      setOpen(false);
      setMonth('');
    },
    refresh: true
  });

  function openDialog() {
    setMonth('');
    reset();
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setMonth('');
  }

  return (
    <>
      <button
        type='button'
        onClick={openDialog}
        className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] transition-colors'
      >
        Сформировать за период
      </button>

      <Dialog
        open={open}
        onClose={closeDialog}
        title='Расчёт комиссии'
        size='sm'
        busy={pending}
        error={errorText}
      >
        <form action={formAction} className='space-y-4'>
          <div>
            <label htmlFor='manual-calc-month' className='block text-sm font-medium text-gray-700 mb-1'>
              Период (месяц)
            </label>
            <input
              id='manual-calc-month'
              type='month'
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              max={new Date().toISOString().slice(0, 7)}
              className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent'
              required
            />
          </div>

          <div className='flex gap-3'>
            <button
              type='button'
              onClick={closeDialog}
              disabled={pending}
              className='flex-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50'
            >
              Отмена
            </button>
            <button
              type='submit'
              disabled={pending || !month}
              className='flex-1 px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 transition-colors'
            >
              {pending ? 'Считаю…' : 'Сформировать'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

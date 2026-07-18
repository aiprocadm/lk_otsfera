'use client';
import React, { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

const ERROR_MAP: Record<string, string> = {
  already_rejected: 'Заявка уже отклонена',
  already_promoted: 'Заявка уже конвертирована в заказ'
};

export function LeadWithdrawButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const { formAction, pending, errorText, reset } = useFetchSubmit({
    url: `/api/partner/leads/${leadId}`,
    method: 'PATCH',
    body: () => ({ action: 'withdraw', reason: reason.trim() }),
    errorMap: ERROR_MAP,
    onSuccess: () => setOpen(false),
    refresh: true
  });

  function openDialog() {
    setReason('');
    reset();
    setOpen(true);
  }

  return (
    <>
      <button
        type='button'
        onClick={openDialog}
        className='px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700'
      >
        Отозвать
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title='Отозвать заявку'
        size='md'
        busy={pending}
        error={errorText}
      >
        <form action={formAction} className='space-y-4'>
          <p className='text-xs text-gray-500'>
            Действие нельзя отменить. Заявка перейдёт в статус «Отклонена».
          </p>

          <label className='block'>
            <span className='text-sm text-gray-700'>Причина (необязательно)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316] resize-y'
              placeholder='Клиент отказался / выбрали другого подрядчика…'
            />
          </label>

          <div className='flex justify-end gap-2 pt-2 border-t border-gray-100'>
            <button
              type='button'
              onClick={() => setOpen(false)}
              className='px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50'
              disabled={pending}
            >
              Отмена
            </button>
            <button
              type='submit'
              disabled={pending}
              className='px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50'
            >
              {pending ? 'Отзываем…' : 'Отозвать'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

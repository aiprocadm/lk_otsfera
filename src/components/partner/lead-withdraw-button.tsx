'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function LeadWithdrawButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setReason('');
    setError(null);
    dialogRef.current?.showModal();
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/partner/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', reason: reason.trim() })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'ALREADY_REJECTED') setError('Заявка уже отклонена');
        else if (body.error === 'ALREADY_PROMOTED') setError('Заявка уже конвертирована в заказ');
        else setError(body.error ?? 'Не удалось отозвать заявку');
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type='button'
        onClick={open}
        className='px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700'
      >
        Отозвать
      </button>

      <dialog
        ref={dialogRef}
        className='rounded-xl p-0 max-w-md w-[92vw] backdrop:bg-black/40'
        onClose={() => setError(null)}
      >
        <form
          method='dialog'
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting) submit();
          }}
          className='p-5 space-y-4'
        >
          <div>
            <h3 className='text-base font-semibold text-[#111111]'>Отозвать заявку</h3>
            <p className='text-xs text-gray-500 mt-1'>
              Действие нельзя отменить. Заявка перейдёт в статус «Отклонена».
            </p>
          </div>

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

          {error && (
            <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
              {error}
            </div>
          )}

          <div className='flex justify-end gap-2 pt-2 border-t border-gray-100'>
            <button
              type='button'
              onClick={() => dialogRef.current?.close()}
              className='px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50'
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type='submit'
              disabled={submitting}
              className='px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50'
            >
              {submitting ? 'Отзываем…' : 'Отозвать'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOrganizationAction } from '@/server-actions/admin/organizations';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Dialog } from '@/components/ui/dialog';

// Дельта поверх errorMessageRu: inn_exists и validation там покрыты, но
// уточняем формулировки под форму создания организации.
const ERROR_MAP: Record<string, string> = {
  validation: 'Укажите название организации.',
  inn_exists: 'Организация с таким ИНН уже есть в системе — найдите её в списке.'
};

export function CreateOrganizationDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { formAction, pending, errorText, reset } = useFormAction<{ id: string }>({
    action: createOrganizationAction,
    errorMap: ERROR_MAP,
    onSuccess: ({ id }) => {
      setOpen(false);
      // Ведём в карточку — там можно дозаполнить партнёра/ставку.
      router.push(`/admin/organizations/${id}`);
    }
  });

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const openDialog = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  return (
    <>
      <button
        type='button'
        onClick={openDialog}
        className='px-3 py-1.5 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] whitespace-nowrap'
      >
        + Добавить организацию
      </button>

      <Dialog
        open={open}
        onClose={close}
        title='Новая организация'
        size='md'
        busy={pending}
        error={errorText}
      >
        <form action={formAction} className='space-y-3'>
          <p className='text-xs text-gray-500'>
            Организация создаётся вручную (без 1С). Синхронизация её не изменяет.
            Партнёра и ставку комиссии можно задать позже в карточке.
          </p>
          <label className='block'>
            <span className='block text-sm font-medium text-gray-700 mb-1'>Название *</span>
            <input
              type='text'
              name='name'
              required
              minLength={1}
              maxLength={200}
              className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
            />
          </label>
          <label className='block'>
            <span className='block text-sm font-medium text-gray-700 mb-1'>ИНН</span>
            <input
              type='text'
              name='inn'
              maxLength={20}
              inputMode='numeric'
              className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
            />
          </label>
          <label className='block'>
            <span className='block text-sm font-medium text-gray-700 mb-1'>КПП</span>
            <input
              type='text'
              name='kpp'
              maxLength={20}
              inputMode='numeric'
              className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
            />
          </label>

          <div className='flex justify-end gap-2 pt-2'>
            <button
              type='button'
              onClick={close}
              className='px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50'
            >
              Отмена
            </button>
            <button
              type='submit'
              disabled={pending}
              className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
            >
              {pending ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

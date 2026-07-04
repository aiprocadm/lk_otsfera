'use client';

import React, { useCallback, useState } from 'react';
import {
  assignOrInviteManagerAction,
  type AssignOrInviteManagerActionResult
} from '@/server-actions/admin/manager';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Dialog } from '@/components/ui/dialog';

type Mode = 'existing' | 'new';

// Дельты поверх errorMessageRu (validation/not_found там уже есть).
const ERROR_MAP: Record<string, string> = {
  validation: 'Проверьте формат email и заполненность полей.',
  org_not_found: 'Организация не найдена.',
  user_not_found: 'Пользователь с таким email не найден. Используйте режим «Пригласить нового».',
  role_conflict: 'У этого email уже другая роль на платформе.',
  already_assigned: 'Этот менеджер уже назначен на организацию.'
};

type SuccessData = {
  inviteUrl: string | null;
  alreadyHasPassword: boolean;
  reactivated: boolean;
};

export function AssignOrInviteManagerForm({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('existing');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [copied, setCopied] = useState(false);

  // Email не входит в Result-payload экшена — снимаем его из FormData в обёртке
  // и кладём в state, чтобы success-UI показал адрес.
  const action = useCallback(
    (formData: FormData): Promise<AssignOrInviteManagerActionResult> => {
      setSubmittedEmail(String(formData.get('email') ?? ''));
      return assignOrInviteManagerAction(formData);
    },
    []
  );

  const { formAction, pending, errorText, data, success, reset } = useFormAction<SuccessData>({
    action,
    errorMap: ERROR_MAP
  });

  const close = useCallback(() => {
    setOpen(false);
    setMode('existing');
    setCopied(false);
    reset();
  }, [reset]);

  const openDialog = useCallback(() => {
    setCopied(false);
    reset();
    setOpen(true);
  }, [reset]);

  async function copyInvite() {
    if (!data?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(data.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts — fall through silently.
    }
  }

  return (
    <>
      <button
        type='button'
        onClick={openDialog}
        className='px-3 py-1.5 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C]'
      >
        Назначить менеджера
      </button>

      <Dialog
        open={open}
        onClose={close}
        title='Назначить менеджера'
        size='md'
        busy={pending}
        error={errorText}
      >
        {success && data ? (
          <div className='space-y-3'>
            {data.reactivated ? (
              <p className='text-sm text-gray-700'>
                Доступ для <strong>{submittedEmail}</strong> восстановлен.
              </p>
            ) : data.alreadyHasPassword ? (
              <p className='text-sm text-gray-700'>
                <strong>{submittedEmail}</strong> уже зарегистрирован на платформе.
                Доступ к организации предоставлен.
              </p>
            ) : (
              <>
                <p className='text-sm text-gray-700'>
                  Приглашение отправлено на <strong>{submittedEmail}</strong>. При
                  необходимости перешлите ссылку вручную:
                </p>
                <div className='flex gap-2 items-center'>
                  <input
                    readOnly
                    aria-label='Ссылка приглашения'
                    value={data.inviteUrl ?? ''}
                    className='flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1.5 bg-gray-50'
                  />
                  <button
                    type='button'
                    onClick={copyInvite}
                    className='px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 whitespace-nowrap'
                  >
                    {copied ? 'Скопировано ✓' : 'Скопировать'}
                  </button>
                </div>
              </>
            )}
            <div className='flex justify-end pt-2'>
              <button
                type='button'
                onClick={close}
                className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
              >
                Закрыть
              </button>
            </div>
          </div>
        ) : (
          <form action={formAction} className='space-y-3'>
            <input type='hidden' name='organizationId' value={organizationId} />
            <input type='hidden' name='mode' value={mode} />
            <div
              className='flex border border-gray-200 rounded-lg p-1 bg-gray-50'
              role='tablist'
              aria-label='Способ назначения'
            >
              <button
                type='button'
                role='tab'
                aria-selected={mode === 'existing'}
                onClick={() => {
                  setMode('existing');
                  reset();
                }}
                className={`flex-1 px-3 py-1.5 text-sm rounded-md transition ${
                  mode === 'existing'
                    ? 'bg-white text-[#111111] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Существующий
              </button>
              <button
                type='button'
                role='tab'
                aria-selected={mode === 'new'}
                onClick={() => {
                  setMode('new');
                  reset();
                }}
                className={`flex-1 px-3 py-1.5 text-sm rounded-md transition ${
                  mode === 'new'
                    ? 'bg-white text-[#111111] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Пригласить нового
              </button>
            </div>

            <label className='block'>
              <span className='block text-sm font-medium text-gray-700 mb-1'>Email</span>
              <input
                type='email'
                name='email'
                required
                autoComplete='email'
                className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
              />
            </label>

            {mode === 'new' && (
              <label className='block'>
                <span className='block text-sm font-medium text-gray-700 mb-1'>
                  Имя (необязательно)
                </span>
                <input
                  type='text'
                  name='name'
                  maxLength={200}
                  className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
                />
              </label>
            )}

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
                {pending
                  ? 'Сохраняем…'
                  : mode === 'existing'
                    ? 'Назначить'
                    : 'Пригласить'}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

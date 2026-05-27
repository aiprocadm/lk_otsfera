'use client';

import { useState, useTransition } from 'react';
import {
  assignOrInviteManagerAction,
  type AssignOrInviteManagerActionResult
} from '@/server-actions/admin/manager';

type Mode = 'existing' | 'new';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте формат email и заполненность полей.',
  org_not_found: 'Организация не найдена.',
  user_not_found: 'Пользователь с таким email не найден. Используйте режим «Пригласить нового».',
  role_conflict: 'У этого email уже другая роль на платформе.',
  already_assigned: 'Этот менеджер уже назначен на организацию.'
};

type SuccessState = {
  email: string;
  inviteUrl: string | null;
  alreadyHasPassword: boolean;
  reactivated: boolean;
};

export function AssignOrInviteManagerForm({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('existing');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setError(null);
    setSuccess(null);
    setCopied(false);
  }
  function close() {
    setOpen(false);
    setMode('existing');
    reset();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    const formData = new FormData(e.currentTarget);
    formData.set('organizationId', organizationId);
    formData.set('mode', mode);
    const email = String(formData.get('email') ?? '');

    startTransition(async () => {
      const res: AssignOrInviteManagerActionResult = await assignOrInviteManagerAction(formData);
      if (res.ok) {
        setSuccess({
          email,
          inviteUrl: res.inviteUrl,
          alreadyHasPassword: res.alreadyHasPassword,
          reactivated: res.reactivated
        });
      } else {
        setError(ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}`);
      }
    });
  }

  async function copyInvite() {
    if (!success?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(success.inviteUrl);
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
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className='px-3 py-1.5 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C]'
      >
        Назначить менеджера
      </button>

      {open && (
        <div
          className='fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4'
          onClick={close}
          role='dialog'
          aria-modal='true'
        >
          <div
            className='bg-white rounded-xl shadow-xl max-w-md w-full p-6'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex items-center justify-between mb-4'>
              <h2 className='text-lg font-semibold text-[#111111]'>
                Назначить менеджера
              </h2>
              <button
                type='button'
                onClick={close}
                className='text-gray-400 hover:text-gray-600 text-xl leading-none'
                aria-label='Закрыть'
              >
                ×
              </button>
            </div>

            {success ? (
              <div className='space-y-3'>
                {success.reactivated ? (
                  <p className='text-sm text-gray-700'>
                    Доступ для <strong>{success.email}</strong> восстановлен.
                  </p>
                ) : success.alreadyHasPassword ? (
                  <p className='text-sm text-gray-700'>
                    <strong>{success.email}</strong> уже зарегистрирован на платформе.
                    Доступ к организации предоставлен.
                  </p>
                ) : (
                  <>
                    <p className='text-sm text-gray-700'>
                      Приглашение отправлено на <strong>{success.email}</strong>. При
                      необходимости перешлите ссылку вручную:
                    </p>
                    <div className='flex gap-2 items-center'>
                      <input
                        readOnly
                        value={success.inviteUrl ?? ''}
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
              <form onSubmit={onSubmit} className='space-y-3'>
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
                  <span className='block text-sm font-medium text-gray-700 mb-1'>
                    Email
                  </span>
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

                {error && (
                  <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2'>
                    {error}
                  </div>
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
          </div>
        </div>
      )}
    </>
  );
}

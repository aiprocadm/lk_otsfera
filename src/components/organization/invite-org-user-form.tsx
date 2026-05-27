'use client';

import { useEffect, useState, useTransition } from 'react';
import { inviteOrgMemberAction } from '@/server-actions/organization/team';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте формат email и заполненность полей.',
  already_member: 'Этот пользователь уже состоит в организации.',
  last_admin_protected: 'Нельзя оставить организацию без активного администратора.',
  self_action_forbidden: 'Нельзя выполнить это действие над собой.',
  not_found: 'Запись не найдена.',
  forbidden: 'Нет прав на это действие.'
};

type SuccessState = {
  email: string;
  inviteUrl: string | null;
  alreadyHasPassword: boolean;
};

export function InviteOrgUserForm({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
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
    reset();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    const formData = new FormData(e.currentTarget);
    formData.set('organizationId', organizationId);
    const email = String(formData.get('email') ?? '');

    startTransition(async () => {
      const res = await inviteOrgMemberAction(formData);
      if (res.ok) {
        setSuccess({
          email,
          inviteUrl: res.inviteUrl,
          alreadyHasPassword: res.alreadyHasPassword
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
        className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C]'
      >
        Пригласить участника
      </button>

      {open && (
        <div
          className='fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4'
          onClick={close}
          role='dialog'
          aria-modal='true'
          aria-labelledby='invite-org-user-title'
        >
          <div
            className='bg-white rounded-xl shadow-xl max-w-md w-full p-6'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex items-center justify-between mb-4'>
              <h2
                id='invite-org-user-title'
                className='text-lg font-semibold text-[#111111]'
              >
                Пригласить участника
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
                {success.alreadyHasPassword ? (
                  <p className='text-sm text-gray-700'>
                    Пользователь <strong>{success.email}</strong> уже зарегистрирован
                    на платформе — доступ к организации предоставлен. Письмо не
                    отправляли.
                  </p>
                ) : (
                  <>
                    <p className='text-sm text-gray-700'>
                      Письмо приглашения отправлено на{' '}
                      <strong>{success.email}</strong>. Если письмо не дошло,
                      перешлите ссылку вручную:
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
                <label className='block'>
                  <span className='block text-sm font-medium text-gray-700 mb-1'>
                    Имя
                  </span>
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
                  <span className='block text-sm font-medium text-gray-700 mb-1'>
                    Роль
                  </span>
                  <select
                    name='roleInOrg'
                    defaultValue='member'
                    className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#F97316]'
                  >
                    <option value='member'>Сотрудник</option>
                    <option value='admin'>Администратор</option>
                  </select>
                </label>

                {error && (
                  <div
                    role='alert'
                    className='text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2'
                  >
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
                    {pending ? 'Отправляем…' : 'Пригласить'}
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

'use client';

import { useCallback, useState } from 'react';
import {
  invitePartnerOrgAdminAction,
  type InvitePartnerActionResult
} from '@/server-actions/partner/inviteOrgAdmin';
import {
  inviteAdminOrgAdminAction,
  type InviteAdminActionResult
} from '@/server-actions/admin/inviteOrgAdmin';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';
import { Dialog } from '@/components/ui/dialog';

type InviteSource = 'partner' | 'admin';

type ActionResultUnion = InvitePartnerActionResult | InviteAdminActionResult;

function runInvite(
  source: InviteSource,
  formData: FormData
): Promise<ActionResultUnion> {
  return source === 'partner'
    ? invitePartnerOrgAdminAction(formData)
    : inviteAdminOrgAdminAction(formData);
}

// Дельты поверх errorMessageRu: validation/not_found/forbidden там заточены под
// загрузку документа — здесь org-invite-формулировки.
const ERROR_MAP: Record<string, string> = {
  validation: 'Проверьте формат email и заполненность полей.',
  not_found: 'Организация не найдена.',
  forbidden: 'Нет прав приглашать в эту организацию.',
  already_member: 'Этот пользователь уже состоит в организации.',
  last_admin_protected: 'Защита от удаления последнего администратора.',
  self_action_forbidden: 'Нельзя выполнить это действие над собой.'
};

type SuccessData = {
  user: { id: string; email: string };
  inviteUrl: string | null;
  alreadyHasPassword: boolean;
};

export function InviteCustomerAdminForm({
  organizationId,
  label = 'Пригласить администратора',
  source = 'partner'
}: {
  organizationId: string;
  label?: string;
  source?: InviteSource;
}) {
  const [open, setOpen] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [copied, setCopied] = useState(false);

  // Email не входит в Result-payload экшена — снимаем его из FormData в обёртке,
  // которая заодно выбирает экшен по source.
  const action = useCallback(
    (formData: FormData): Promise<ActionResult<SuccessData>> => {
      setSubmittedEmail(String(formData.get('email') ?? ''));
      return runInvite(source, formData) as Promise<ActionResult<SuccessData>>;
    },
    [source]
  );

  const { formAction, pending, errorText, data, success, reset } = useFormAction<SuccessData>({
    action,
    errorMap: ERROR_MAP
  });

  const close = useCallback(() => {
    setOpen(false);
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
        {label}
      </button>

      <Dialog
        open={open}
        onClose={close}
        title='Пригласить администратора заказчика'
        size='md'
        busy={pending}
        error={errorText}
      >
        {success && data ? (
          <div className='space-y-3'>
            {data.alreadyHasPassword ? (
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
            <label className='block'>
              <span className='block text-sm font-medium text-gray-700 mb-1'>Имя</span>
              <input
                type='text'
                name='name'
                required
                minLength={1}
                maxLength={200}
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
                {pending ? 'Отправляем…' : 'Пригласить'}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

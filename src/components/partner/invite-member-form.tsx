'use client';
import React, { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

const ERROR_MAP: Record<string, string> = {
  email_taken: 'Пользователь с таким email уже существует',
  org_out_of_scope: 'Одна из организаций не входит в портфель партнёра'
};

type InviteResult = { inviteUrl: string; emailStatus: 'sent' | 'skipped' };

export function InviteMemberForm({
  orgs
}: {
  orgs: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleInPartner, setRole] = useState<'admin' | 'manager'>('manager');
  const [allOrgs, setAllOrgs] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // ФТ-10.1/10.2: после создания показываем ссылку установки пароля —
  // фолбэк «Скопировать» на случай не дошедшего/выключенного письма.
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { formAction, pending, errorText, reset } = useFetchSubmit<InviteResult>({
    url: '/api/partner/team',
    body: () => ({
      email,
      name,
      roleInPartner,
      assignedOrgIds: allOrgs ? [] : [...selected]
    }),
    errorMap: ERROR_MAP,
    onSuccess: (data) => setInvite(data),
    refresh: true
  });

  function openDialog() {
    setEmail('');
    setName('');
    setRole('manager');
    setAllOrgs(true);
    setSelected(new Set());
    setInvite(null);
    setCopied(false);
    reset();
    setOpen(true);
  }

  async function copyInvite() {
    /* v8 ignore next -- недостижимо: кнопка «Скопировать» рендерится только внутри
       ветки `invite ? …`, поэтому к моменту клика приглашение всегда есть. Строка
       оставлена ради сужения типа для TS (invite: Invite | null) — удалить нельзя. */
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function toggleOrg(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const valid = email.trim().length > 3 && email.includes('@') && name.trim().length > 0;

  return (
    <>
      <button
        type='button'
        onClick={openDialog}
        className='inline-flex items-center gap-1.5 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
      >
        <span className='text-lg leading-none'>+</span>
        Пригласить
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title='Пригласить сотрудника'
        size='lg'
        busy={pending}
        error={errorText}
      >
        {invite ? (
          <div className='space-y-3'>
            <p className='text-sm text-gray-700'>
              {invite.emailStatus === 'sent' ? (
                <>
                  Письмо приглашения отправлено на <strong>{email}</strong>.
                  Если письмо не дошло, перешлите ссылку вручную:
                </>
              ) : (
                <>
                  Аккаунт для <strong>{email}</strong> создан. Отправка почты
                  выключена — передайте ссылку установки пароля вручную:
                </>
              )}
            </p>
            <div className='flex gap-2 items-center'>
              <input
                readOnly
                aria-label='Ссылка приглашения'
                value={invite.inviteUrl}
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
            <div className='flex justify-end pt-2'>
              <button
                type='button'
                onClick={() => setOpen(false)}
                className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
              >
                Готово
              </button>
            </div>
          </div>
        ) : (
        <form action={formAction} className='space-y-4'>
          <p className='text-xs text-gray-500'>
            Отправим на email письмо со ссылкой для установки пароля — ссылка действует 7 дней.
          </p>

          <label className='block'>
            <span className='text-sm text-gray-700'>Имя</span>
            <input
              type='text'
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
              placeholder='Иван Иванов'
            />
          </label>

          <label className='block'>
            <span className='text-sm text-gray-700'>Email</span>
            <input
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
              placeholder='ivanov@company.ru'
            />
          </label>

          <fieldset>
            <legend className='text-sm text-gray-700 mb-1'>Роль в команде</legend>
            <div className='flex gap-2'>
              <RoleOption
                label='Менеджер'
                hint='доступ к назначенным организациям'
                checked={roleInPartner === 'manager'}
                onChange={() => setRole('manager')}
              />
              <RoleOption
                label='Админ'
                hint='настройки команды и комиссии'
                checked={roleInPartner === 'admin'}
                onChange={() => setRole('admin')}
              />
            </div>
          </fieldset>

          <fieldset className='space-y-2'>
            <legend className='text-sm text-gray-700'>Доступ к организациям</legend>
            <label className='flex items-center gap-2 cursor-pointer'>
              <input
                type='checkbox'
                checked={allOrgs}
                onChange={(e) => setAllOrgs(e.target.checked)}
                className='accent-[#F97316]'
              />
              <span className='text-sm text-[#111111]'>Все организации партнёра</span>
            </label>

            {!allOrgs && (
              <div className='max-h-56 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50'>
                {orgs.length === 0 ? (
                  <div className='p-3 text-xs text-gray-500'>В портфеле нет организаций.</div>
                ) : (
                  orgs.map((org) => (
                    <label
                      key={org.id}
                      className='flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50'
                    >
                      <input
                        type='checkbox'
                        checked={selected.has(org.id)}
                        onChange={() => toggleOrg(org.id)}
                        className='accent-[#F97316]'
                      />
                      <span className='text-sm text-[#111111]'>{org.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </fieldset>

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
              disabled={pending || !valid || (!allOrgs && selected.size === 0)}
              className='px-4 py-2 text-sm bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
            >
              {pending ? 'Отправка…' : 'Пригласить'}
            </button>
          </div>
        </form>
        )}
      </Dialog>
    </>
  );
}

function RoleOption({
  label,
  hint,
  checked,
  onChange
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex-1 cursor-pointer border rounded-lg px-3 py-2 transition-colors ${
        checked
          ? 'border-[#F97316] bg-[#FFF7ED]'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <input type='radio' name='role' checked={checked} onChange={onChange} className='sr-only' />
      <div className={`text-sm font-medium ${checked ? 'text-[#9A3412]' : 'text-[#111111]'}`}>
        {label}
      </div>
      <div className='text-xs text-gray-500 mt-0.5'>{hint}</div>
    </label>
  );
}

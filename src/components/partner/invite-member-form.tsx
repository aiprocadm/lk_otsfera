'use client';
import React, { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

const ERROR_MAP: Record<string, string> = {
  EMAIL_TAKEN: 'Пользователь с таким email уже существует',
  ORG_OUT_OF_SCOPE: 'Одна из организаций не входит в портфель партнёра'
};

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

  const { formAction, pending, errorText, reset } = useFetchSubmit({
    url: '/api/partner/team',
    body: () => ({
      email,
      name,
      roleInPartner,
      assignedOrgIds: allOrgs ? [] : [...selected]
    }),
    errorMap: ERROR_MAP,
    onSuccess: () => setOpen(false),
    refresh: true
  });

  function openDialog() {
    setEmail('');
    setName('');
    setRole('manager');
    setAllOrgs(true);
    setSelected(new Set());
    reset();
    setOpen(true);
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
        <form action={formAction} className='space-y-4'>
          <p className='text-xs text-gray-500'>
            Создадим аккаунт с временным паролем — отправим инструкцию по входу на email.
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

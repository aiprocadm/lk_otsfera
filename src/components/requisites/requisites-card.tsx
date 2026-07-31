'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import type { RequisitesActionResult } from '@/server-actions/requisites';
import { RequisitesFields, type RequisitesDefaults } from './requisites-fields';

/**
 * Этап 8 (ФТ-9.2, PR-1) — карточка «Реквизиты» с формой. Общая оболочка для
 * трёх кабинетов (organization/partner/admin): различие — action и скрытые
 * поля; блок полей — RequisitesFields. `canEdit=false` — read-only подсказка
 * (участник организации без прав правки).
 */
export function RequisitesCard({
  title,
  description,
  defaults,
  idPrefix,
  action,
  hidden = {},
  canEdit = true,
  children
}: {
  title: string;
  description: string;
  defaults: RequisitesDefaults;
  idPrefix: string;
  action: (fd: FormData) => Promise<RequisitesActionResult>;
  /** Скрытые поля формы (orgId / companyId). */
  hidden?: Record<string, string>;
  canEdit?: boolean;
  /** Доп. поля конкретного домена (например phone/email компании). */
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    for (const [k, v] of Object.entries(hidden)) fd.set(k, v);
    setBusy(true);
    setMessages([]);
    const res = await action(fd);
    setBusy(false);
    if (!res.ok) {
      if (res.messages?.length) setMessages(res.messages);
      else toast.error('Не удалось сохранить реквизиты.');
      return;
    }
    toast.success('Реквизиты сохранены.');
  }

  return (
    <div className='rounded-xl border border-gray-200 p-4'>
      <h2 className='font-semibold text-[#111111]'>{title}</h2>
      <p className='text-sm text-gray-600 mt-0.5 mb-3'>{description}</p>
      {canEdit ? (
        <form onSubmit={onSubmit} className='space-y-3'>
          <RequisitesFields defaults={defaults} idPrefix={idPrefix} />
          {children}
          {messages.length > 0 && (
            <ul role='alert' className='text-sm text-red-600 list-disc pl-5 space-y-0.5'>
              {messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <div className='flex justify-end'>
            <Button type='submit' disabled={busy}>
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </div>
        </form>
      ) : (
        <p className='text-sm text-gray-500'>
          Реквизиты может изменять администратор или руководитель организации.
        </p>
      )}
    </div>
  );
}

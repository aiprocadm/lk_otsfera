'use client';

import React, { useState, useTransition } from 'react';
import { Button, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { setSlaSettingsAction } from '@/server-actions/manager/slaSettings';

/**
 * Этап 7 (§4.4, PR-3) — карточка «SLA входящих» на /leader/team (решение
 * §10-3 спеки): часы подсветки и часы эскалации руководителю.
 */
export function SlaSettingsCard({ initial }: { initial: { slaResponseHours: number; slaWarningHours: number } }) {
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState<string[]>([]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const slaWarningHours = Number(fd.get('slaWarningHours'));
    const slaResponseHours = Number(fd.get('slaResponseHours'));
    setMessages([]);
    startTransition(async () => {
      const res = await setSlaSettingsAction({ slaResponseHours, slaWarningHours });
      if (!res.ok) {
        if (res.messages?.length) setMessages(res.messages);
        else toast.error('Не удалось сохранить пороги SLA.');
        return;
      }
      toast.success(res.changed ? 'Пороги SLA сохранены.' : 'Пороги SLA не изменились.');
    });
  }

  return (
    <div className='rounded-lg bg-[#F3F4F6] p-4'>
      <p className='font-medium text-[#111111]'>SLA входящих</p>
      <p className='text-sm text-gray-600 mt-0.5'>
        Заявка или обращение без реакции дольше порога эскалации — руководителю придёт уведомление; порог подсветки
        подкрашивает ожидание на «Входящих в работу».
      </p>
      <form onSubmit={onSubmit} className='mt-3 flex flex-wrap items-end gap-3'>
        <label className='text-sm text-gray-700'>
          Подсветка, ч
          <Input
            name='slaWarningHours'
            type='number'
            min={1}
            max={168}
            defaultValue={initial.slaWarningHours}
            className='mt-1 w-24'
            required
          />
        </label>
        <label className='text-sm text-gray-700'>
          Эскалация, ч
          <Input
            name='slaResponseHours'
            type='number'
            min={1}
            max={168}
            defaultValue={initial.slaResponseHours}
            className='mt-1 w-24'
            required
          />
        </label>
        <Button type='submit' disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </form>
      {messages.length > 0 && (
        <ul role='alert' className='mt-2 text-sm text-red-600 list-disc pl-5 space-y-0.5'>
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

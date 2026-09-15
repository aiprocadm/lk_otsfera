'use client';

import React, { useState, useTransition } from 'react';
import { Button, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { setSlaSettingsAction } from '@/server-actions/manager/slaSettings';

/**
 * Этап 7 (§4.4, PR-3) — карточка «SLA входящих» на /leader/team (решение
 * §10-3 спеки): часы подсветки и часы эскалации руководителю.
 */
export function SlaSettingsCard({
  initial,
}: {
  initial: {
    slaResponseHours: number;
    slaWarningHours: number;
    /** `У-225`: дни просрочки задачи до сообщения руководителю; `0` — не сообщать. */
    taskOverdueEscalationDays: number;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState<string[]>([]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const slaWarningHours = Number(fd.get('slaWarningHours'));
    const slaResponseHours = Number(fd.get('slaResponseHours'));
    const taskOverdueEscalationDays = Number(fd.get('taskOverdueEscalationDays'));
    setMessages([]);
    startTransition(async () => {
      const res = await setSlaSettingsAction({
        slaResponseHours,
        slaWarningHours,
        taskOverdueEscalationDays,
      });
      if (!res.ok) {
        if (res.messages?.length) setMessages(res.messages);
        else toast.error('Не удалось сохранить пороги SLA.');
        return;
      }
      toast.success(res.changed ? 'Пороги SLA сохранены.' : 'Пороги SLA не изменились.');
    });
  }

  return (
    <div className="rounded-lg bg-[#F3F4F6] p-4">
      <p className="font-medium text-[#111111]">Сроки реакции</p>
      <p className="text-sm text-gray-600 mt-0.5">
        Заявка или обращение без реакции дольше порога эскалации — руководителю придёт уведомление;
        порог подсветки подкрашивает ожидание на «Входящих в работу». Просроченная задача напоминает
        о себе исполнителю сразу, а руководителю — через указанное число дней.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          Подсветка, ч
          <Input
            name="slaWarningHours"
            type="number"
            min={1}
            max={168}
            defaultValue={initial.slaWarningHours}
            className="mt-1 w-24"
            required
          />
        </label>
        <label className="text-sm text-gray-700">
          Эскалация, ч
          <Input
            name="slaResponseHours"
            type="number"
            min={1}
            max={168}
            defaultValue={initial.slaResponseHours}
            className="mt-1 w-24"
            required
          />
        </label>
        <label className="text-sm text-gray-700">
          Просрочка задач, дней
          <Input
            name="taskOverdueEscalationDays"
            type="number"
            min={0}
            max={30}
            defaultValue={initial.taskOverdueEscalationDays}
            className="mt-1 w-32"
            required
          />
          <span className="mt-0.5 block text-xs text-gray-500">0 — не сообщать</span>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </form>
      {messages.length > 0 && (
        <ul role="alert" className="mt-2 text-sm text-red-600 list-disc pl-5 space-y-0.5">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

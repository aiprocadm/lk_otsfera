'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createTaskAction } from '@/server-actions/tasks';
import { taskLinkField, taskLinkValue, type TaskLinkRef } from '@/lib/tasks/links';
import type { TaskCard } from '@/lib/services/tasks/board';

/**
 * Блок «Задачи» на карточке объекта: список привязанных задач + быстрое
 * создание (название, срок, «на себя»). Полное редактирование — на странице
 * задачи; здесь только просмотр и quick-add.
 *
 * Этап 7 (ФТ-7.1, ФТ-3.2) сделал его для лида и сделки. Этап 4 (`У-220`)
 * расширил на все семь мест: заказ, организация, лид, сделка, контакт,
 * переписка, документ. Поле связи компонент не выбирает сам — берёт из общего
 * справочника `taskLinkField`, того же, по которому сервис строит выборку.
 *
 * `defaultAssigneeId` — ответственный менеджер объекта: форма ставит галочку
 * «на себя» только когда это текущий пользователь, иначе назначает его.
 */

export function LinkedTasksPanel({
  link,
  tasks,
  currentUserId,
  defaultAssigneeId,
  onCreated,
}: {
  link: TaskLinkRef;
  tasks: TaskCard[];
  currentUserId: string;
  /** `У-220`: ответственный менеджер объекта — кого предлагаем исполнителем. */
  defaultAssigneeId?: string | null;
  /** Дефолт — router.refresh(); диалог сделки передаёт свой релоад списка. */
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleQuickAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set(taskLinkField(link), taskLinkValue(link));
    if (fd.get('assignSelf') === 'on') fd.append('assigneeIds', currentUserId);
    // `У-220`: галочка снята, но у объекта есть ответственный — задача уходит
    // ему, а не в никуда. Задача без исполнителя на общей доске теряется.
    else if (defaultAssigneeId) fd.append('assigneeIds', defaultAssigneeId);
    fd.delete('assignSelf');
    setBusy(true);
    const res = await createTaskAction(fd);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось создать задачу.'));
      return;
    }
    toast.success('Задача создана.');
    form.reset();
    setAdding(false);
    if (onCreated) onCreated();
    else startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400">Привязанных задач нет.</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full shrink-0 ${t.completedAt ? 'bg-green-500' : 'bg-[#F97316]'}`}
                aria-hidden
              />
              <span className={t.completedAt ? 'text-gray-400 line-through' : 'text-[#111111]'}>
                {t.title}
              </span>
              {t.dueDate && (
                <span className="text-xs text-gray-500 shrink-0">
                  до {new Date(t.dueDate).toLocaleDateString('ru-RU')}
                </span>
              )}
              {t.assigneeNames.length > 0 && (
                <span className="text-xs text-gray-400 truncate">{t.assigneeNames.join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={handleQuickAdd} className="space-y-2">
          <Input
            name="title"
            required
            maxLength={200}
            placeholder="Что нужно сделать"
            autoFocus
            aria-label="Название задачи"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input name="dueDate" type="date" className="w-40" aria-label="Срок" />
            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input type="checkbox" name="assignSelf" defaultChecked className="h-4 w-4 rounded" />
              на себя
            </label>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAdding(false)}
                disabled={busy}
              >
                Отмена
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? 'Создаю…' : 'Создать'}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          + Задача
        </Button>
      )}
    </div>
  );
}

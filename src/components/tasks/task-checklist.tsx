'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
} from '@/server-actions/tasks';
import type { ChecklistItemView } from '@/lib/services/tasks/checklist';

/**
 * Чек-лист задачи (`У-219`). Шаги внутри одной задачи: отметить, добавить,
 * удалить. Прогресс «3 из 5» виден и здесь, и на карточке доски.
 *
 * Завершение задачи с невыполненными пунктами запрещает не этот компонент, а
 * сервер (`moveTask` → `checklist_incomplete`): кнопка «Готово» живёт на доске
 * и на карточке, и прятать её здесь значило бы защищать внешним видом.
 */
export function TaskChecklist({ taskId, items }: { taskId: string; items: ChecklistItemView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const done = items.filter((i) => i.isDone).length;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, failed: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error ?? '', failed));
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('taskId', taskId);
    await run(() => addChecklistItemAction(fd), 'Не удалось добавить пункт.');
    form.reset();
  }

  function handleToggle(itemId: string, isDone: boolean) {
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('itemId', itemId);
    fd.set('isDone', isDone ? 'true' : 'false');
    void run(() => toggleChecklistItemAction(fd), 'Не удалось отметить пункт.');
  }

  function handleDelete(itemId: string) {
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('itemId', itemId);
    void run(() => deleteChecklistItemAction(fd), 'Не удалось удалить пункт.');
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#111111]">Чек-лист</h2>
        {items.length > 0 && (
          <span className="text-xs text-gray-500">
            {done} из {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">
          Чек-лист пуст. Разбейте задачу на шаги — их видно прямо на карточке доски.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={item.isDone}
                disabled={busy}
                onChange={(e) => handleToggle(item.id, e.currentTarget.checked)}
                aria-label={item.title}
              />
              <span className={item.isDone ? 'text-gray-400 line-through' : 'text-[#111111]'}>
                {item.title}
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-gray-400 hover:text-gray-600"
                disabled={busy}
                onClick={() => handleDelete(item.id)}
                aria-label={`Удалить пункт «${item.title}»`}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          name="title"
          required
          maxLength={200}
          placeholder="Добавить шаг"
          aria-label="Название пункта чек-листа"
        />
        <Button type="submit" size="sm" disabled={busy}>
          Добавить
        </Button>
      </form>
    </section>
  );
}

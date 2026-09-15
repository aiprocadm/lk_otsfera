'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { addTaskCommentAction } from '@/server-actions/tasks';
import type { TaskCommentView } from '@/lib/services/tasks/comments';

/**
 * Обсуждение внутри задачи (`У-218`).
 *
 * Видно только сотрудникам: задачи в клиентский контур не выходят вовсе. Это
 * не то же самое, что комментарии к заказу (`Comment`) — те клиент читает.
 *
 * `@Имя Фамилия` зовёт коллегу: ему придёт уведомление со ссылкой на эту
 * страницу. Разбор имён — на сервере по списку сотрудников, здесь подсказка.
 */
export function TaskComments({
  taskId,
  comments,
}: {
  taskId: string;
  comments: TaskCommentView[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('taskId', taskId);
    setBusy(true);
    const res = await addTaskCommentAction(fd);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось отправить комментарий.'));
      return;
    }
    form.reset();
    startTransition(() => router.refresh());
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-[#111111]">Обсуждение</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-gray-500">
          Обсуждения пока нет. Напишите первым — коллегу можно позвать через «@» и его имя.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-[#111111]">{c.authorName}</span>
                <span className="text-xs text-gray-400">
                  {new Date(c.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          name="body"
          required
          rows={3}
          maxLength={4000}
          placeholder="Комментарий для коллег. «@Имя Фамилия» — позвать человека."
          aria-label="Текст комментария"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Отправляю…' : 'Отправить'}
          </Button>
        </div>
      </form>
    </section>
  );
}

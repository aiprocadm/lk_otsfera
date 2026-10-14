'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { MentionTextarea, type MentionOption } from '@/components/ui/mention-textarea';
import { MentionText } from '@/components/ui/mention-text';
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
 * страницу. Разбор имён — на сервере по списку сотрудников. `У-282` (`Д-57`):
 * раньше поле было обычным — имя приходилось набирать точь-в-точь вслепую, и
 * упоминание «не работало»; теперь после «@» поле подсказывает коллег (тот же
 * список, что у сервера), а в ленте упоминание выделено.
 */
export function TaskComments({
  taskId,
  comments,
  colleagues,
}: {
  taskId: string;
  comments: TaskCommentView[];
  colleagues: MentionOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const names = colleagues.map((c) => c.name);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('body', body);
    setBusy(true);
    const res = await addTaskCommentAction(fd);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось отправить комментарий.'));
      return;
    }
    setBody('');
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
                  {new Date(c.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                <MentionText text={c.body} names={names} />
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <MentionTextarea
          value={body}
          onChange={setBody}
          colleagues={colleagues}
          required
          rows={3}
          maxLength={4000}
          placeholder="Комментарий для коллег. Наберите «@» — появится список, кого позвать."
          aria-label="Текст комментария"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-[#111111] outline-none focus:border-orange-400"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy || !body.trim()}>
            {busy ? 'Отправляю…' : 'Отправить'}
          </Button>
        </div>
      </form>
    </section>
  );
}

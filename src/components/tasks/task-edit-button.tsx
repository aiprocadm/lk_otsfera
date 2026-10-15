'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import type { TaskColumnView } from '@/lib/tasks/columns';
import type { TaskCard, TaskFormOptions } from '@/lib/services/tasks/board';
import { TaskDialog } from './task-dialog';

/**
 * «Редактировать» на странице задачи (этап 5 ТЗ 13.10.2026, `У-302`, `Р-5-7`).
 *
 * Править задачу можно было только с доски: со страницы задачи — ссылкой,
 * присланной в уведомлении, — дойти до формы было нельзя. Форма та же, что на
 * доске; каждое изменение пишется в журнал, и история на странице его
 * показывает. После удаления — в список задач: страницы больше нет.
 */
export function TaskEditButton({
  card,
  columns,
  options,
  listHref,
}: {
  card: TaskCard;
  columns: TaskColumnView[];
  options: TaskFormOptions;
  listHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Редактировать
      </Button>
      {open && (
        <TaskDialog
          target={card}
          columns={columns}
          options={options}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
          onDeleted={() => router.push(listHref)}
        />
      )}
    </>
  );
}

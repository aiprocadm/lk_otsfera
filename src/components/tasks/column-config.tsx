'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Field, Dialog, TableShell, THead, Th, Tr, Td, Badge } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createTaskColumnAction, updateTaskColumnAction, deleteTaskColumnAction } from '@/server-actions/tasks';
import type { TaskColumnView } from '@/lib/tasks/columns';

const ANCHORS: { value: string; label: string }[] = [
  { value: 'todo', label: 'К выполнению' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'done', label: 'Готово' }
];
const anchorLabel = (a: string) => ANCHORS.find((x) => x.value === a)?.label ?? a;

export function ColumnConfig({ columns, isDefault }: { columns: TaskColumnView[]; isDefault: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ target: TaskColumnView | null } | null>(null);

  async function handleDelete(c: TaskColumnView) {
    const fd = new FormData();
    fd.set('id', c.id);
    const res = await deleteTaskColumnAction(fd);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось удалить колонку.'));
      return;
    }
    toast.success('Колонка удалена.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#111111]">Колонки канбана</h2>
          {isDefault && (
            <p className="text-xs text-gray-500 mt-0.5">
              Сейчас используются колонки по умолчанию. Создав свою первую колонку, вы замените набор — задайте все нужные колонки.
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setEditing({ target: null })}>
          + Колонка
        </Button>
      </div>

      <TableShell>
        <THead>
          <Th>Позиция</Th>
          <Th>Название</Th>
          <Th>Якорь статуса</Th>
          <Th>Колонка «Готово»</Th>
          <Th>Действия</Th>
        </THead>
        <tbody>
          {columns.map((c) => (
            <Tr key={c.id}>
              <Td>{c.position}</Td>
              <Td className="font-medium">{c.name}</Td>
              <Td>
                <Badge tone="neutral">{anchorLabel(c.statusAnchor)}</Badge>
              </Td>
              <Td>{c.isDoneColumn ? 'Да' : '—'}</Td>
              <Td>
                {isDefault ? (
                  <span className="text-gray-400 text-sm">по умолчанию</span>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ target: c })}>
                      Изменить
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(c)}>
                      Удалить
                    </Button>
                  </div>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {editing && (
        <ColumnDialog
          key={editing.target?.id ?? 'new'}
          target={editing.target}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function ColumnDialog({
  target,
  onClose,
  onSaved
}: {
  target: TaskColumnView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    const res = target ? await updateTaskColumnAction(fd) : await createTaskColumnAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить колонку.'));
      return;
    }
    toast.success(target ? 'Колонка обновлена.' : 'Колонка создана.');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={target ? 'Изменить колонку' : 'Новая колонка'} size="md" busy={submitting}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="col-name" label="Название">
          <Input id="col-name" name="name" required maxLength={60} defaultValue={target?.name ?? ''} autoFocus />
        </Field>
        <Field htmlFor="col-position" label="Позиция (порядок колонки)">
          <Input id="col-position" name="position" type="number" min={0} defaultValue={target?.position ?? 0} />
        </Field>
        <Field htmlFor="col-anchor" label="Якорь статуса">
          <Select id="col-anchor" name="statusAnchor" defaultValue={target?.statusAnchor ?? 'todo'}>
            {ANCHORS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" name="isDoneColumn" defaultChecked={target?.isDoneColumn ?? false} className="h-4 w-4 rounded" />
          <span>Колонка «Готово» (проставляет дату завершения)</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Сохраняю…' : target ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

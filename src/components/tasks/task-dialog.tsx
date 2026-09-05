'use client';

import React, { useState } from 'react';
import { Button, Input, Textarea, Select, Field, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createTaskAction, updateTaskAction, deleteTaskAction } from '@/server-actions/tasks';
import type { TaskColumnView } from '@/lib/tasks/columns';
import type { TaskCard, TaskFormOptions } from '@/lib/services/tasks/board';

export type { TaskFormOptions };

const PRIORITIES: { value: string; label: string }[] = [
  { value: '', label: 'Без приоритета' },
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
];

function dateValue(d: Date | null): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * `Р-27`: селекты организации/заявки усечены сервисом (200/100). Текущая
 * привязка редактируемой задачи обязана быть в списке — иначе `defaultValue`
 * не найдёт свой `<option>`, браузер покажет «— не привязана —», и сохранение
 * молча сотрёт связь (`updateTask` пишет `?? null`).
 */
function withCurrent<T extends { id: string }>(
  list: T[],
  current: { id: string | null; label: string | null } | null,
  make: (id: string, label: string) => T
): T[] {
  if (!current?.id || list.some((o) => o.id === current.id)) return list;
  return [make(current.id, current.label ?? 'Текущая привязка'), ...list];
}

/** Подпись под усечённым селектом; `null`, пока скрывать нечего. */
function capHint(shown: number, total: number, what: string): string | null {
  return total > shown ? `Показаны ${shown} из ${total} ${what}.` : null;
}

/** Этап 7 (ФТ-7.1): префилл привязки при создании из карточки лида/сделки. */
export type TaskDialogLink = { leadId?: string; dealId?: string; label: string };

export function TaskDialog({
  target,
  columns,
  options,
  link,
  onClose,
  onSaved,
}: {
  target: TaskCard | null;
  columns: TaskColumnView[];
  options: TaskFormOptions;
  link?: TaskDialogLink;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  // Привязки к лиду/сделке задаются контекстом (link) или сохраняются с target —
  // скрытые поля обязательны: без них редактирование стирало бы связь (taskInput → null).
  const linkedLeadId = link?.leadId ?? target?.linkedLeadId ?? '';
  const linkedDealId = link?.dealId ?? target?.linkedDealId ?? '';
  const linkLabel =
    link?.label ??
    [
      target?.linkedLeadSubject ? `лид «${target.linkedLeadSubject}»` : null,
      target?.linkedDealTitle ? `сделка «${target.linkedDealTitle}»` : null,
    ]
      .filter(Boolean)
      .join(', ');

  const organizations = withCurrent(
    options.organizations,
    target ? { id: target.linkedOrganizationId, label: target.linkedOrganizationName } : null,
    (id, name) => ({ id, name })
  );
  const orders = withCurrent(
    options.orders,
    target ? { id: target.linkedOrderId, label: target.linkedOrderTitle } : null,
    (id, title) => ({ id, title })
  );
  const orgHint = capHint(
    options.organizations.length,
    options.organizationsTotal,
    'организаций с последней активностью'
  );
  const orderHint = capHint(options.orders.length, options.ordersTotal, 'последних заявок');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    const res = target ? await updateTaskAction(fd) : await createTaskAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить задачу.'));
      return;
    }
    toast.success(target ? 'Задача обновлена.' : 'Задача создана.');
    onSaved();
  }

  async function handleDelete() {
    // defense-in-depth: the delete Button that calls handleDelete only renders
    // when `target` is truthy (see `{target && <Button onClick={handleDelete}>}`
    // below), so this guard is unreachable via UI; kept in case handleDelete is
    // ever wired to a trigger that doesn't share that condition.
    /* v8 ignore next */
    if (!target) return;
    const fd = new FormData();
    fd.set('id', target.id);
    setSubmitting(true);
    const res = await deleteTaskAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось удалить задачу.'));
      return;
    }
    toast.success('Задача удалена.');
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={target ? 'Задача' : 'Новая задача'}
      size="lg"
      busy={submitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="linkedLeadId" value={linkedLeadId} />
        <input type="hidden" name="linkedDealId" value={linkedDealId} />
        {linkLabel && <p className="text-xs text-gray-500">Привязана: {linkLabel}</p>}
        <Field htmlFor="tk-title" label="Название">
          <Input
            id="tk-title"
            name="title"
            required
            maxLength={200}
            defaultValue={target?.title ?? ''}
            autoFocus
          />
        </Field>
        <Field htmlFor="tk-desc" label="Описание">
          <Textarea
            id="tk-desc"
            name="description"
            rows={3}
            defaultValue={target?.description ?? ''}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field htmlFor="tk-priority" label="Приоритет">
            <Select id="tk-priority" name="priority" defaultValue={target?.priority ?? ''}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="tk-due" label="Срок">
            <Input
              id="tk-due"
              name="dueDate"
              type="date"
              defaultValue={dateValue(target?.dueDate ?? null)}
            />
          </Field>
          <Field htmlFor="tk-col" label="Колонка">
            <Select
              id="tk-col"
              name="columnId"
              defaultValue={target?.columnId ?? columns[0]?.id ?? ''}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            htmlFor="tk-org"
            label="Организация (необязательно)"
            {...(orgHint ? { hint: orgHint } : {})}
          >
            <Select
              id="tk-org"
              name="linkedOrganizationId"
              defaultValue={target?.linkedOrganizationId ?? ''}
            >
              <option value="">— не привязана —</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            htmlFor="tk-order"
            label="Заявка (необязательно)"
            {...(orderHint ? { hint: orderHint } : {})}
          >
            <Select id="tk-order" name="linkedOrderId" defaultValue={target?.linkedOrderId ?? ''}>
              <option value="">— не привязана —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <p className="text-sm font-medium text-[#111111] mb-2">Исполнители</p>
          {options.users.length === 0 ? (
            <p className="text-xs text-gray-400">Нет доступных сотрудников.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {options.users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    name="assigneeIds"
                    value={u.id}
                    defaultChecked={target?.assigneeIds.includes(u.id) ?? false}
                    className="h-4 w-4 rounded"
                  />
                  <span>{u.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-between gap-2 pt-2">
          <div>
            {target && (
              <Button type="button" variant="danger" onClick={handleDelete} disabled={submitting}>
                Удалить
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Сохраняю…' : target ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

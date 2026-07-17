'use client';

import React, { useState } from 'react';
import { Button, Input, Textarea, Select, Field, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createEventAction, updateEventAction, deleteEventAction } from '@/server-actions/calendar';
import type { CalendarItem, EventFormOptions } from '@/lib/services/calendar/items';

/**
 * M5 — диалог создания/редактирования события staff-календаря (спека §4).
 * Sibling-домен manager/leader (страницы обе рендерят его же — компонент
 * презентационный над domain-agnostic CalendarItem). Идиома task-dialog G3.
 */

const REMIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Без напоминания' },
  { value: '15', label: 'За 15 минут' },
  { value: '60', label: 'За 1 час' },
  { value: '1440', label: 'За 1 день' }
];

/** Date → значение для input type="datetime-local" в локальной TZ браузера. */
function dateTimeValue(d: Date | null): string {
  if (!d) return '';
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function EventDialog({
  target,
  createDate,
  options,
  onClose,
  onSaved
}: {
  /** Событие для редактирования; null → создание. */
  target: CalendarItem | null;
  /** Дата-прообраз для создания (клик по дню сетки). */
  createDate: Date | null;
  options: EventFormOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const defaultStart = target
    ? new Date(target.date)
    : createDate
      ? new Date(new Date(createDate).setHours(10, 0, 0, 0))
      : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    const res = target ? await updateEventAction(fd) : await createEventAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить событие.'));
      return;
    }
    toast.success(target ? 'Событие обновлено.' : 'Событие создано.');
    onSaved();
  }

  async function handleDelete() {
    // defense-in-depth: кнопка «Удалить» рендерится только при target (см. JSX).
    /* v8 ignore next */
    if (!target) return;
    const fd = new FormData();
    fd.set('id', target.id);
    setSubmitting(true);
    const res = await deleteEventAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось удалить событие.'));
      return;
    }
    toast.success('Событие удалено.');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={target ? 'Событие' : 'Новое событие'} size="lg" busy={submitting}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="ev-title" label="Название">
          <Input id="ev-title" name="title" required maxLength={200} defaultValue={target?.title ?? ''} autoFocus />
        </Field>
        <Field htmlFor="ev-desc" label="Описание">
          <Textarea id="ev-desc" name="description" rows={3} defaultValue={target?.description ?? ''} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field htmlFor="ev-starts" label="Начало">
            <Input
              id="ev-starts"
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={dateTimeValue(defaultStart)}
            />
          </Field>
          <Field htmlFor="ev-ends" label="Окончание (необязательно)">
            <Input id="ev-ends" name="endsAt" type="datetime-local" defaultValue={dateTimeValue(target?.endsAt ?? null)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field htmlFor="ev-location" label="Место / ссылка">
            <Input id="ev-location" name="location" maxLength={300} defaultValue={target?.location ?? ''} />
          </Field>
          <Field htmlFor="ev-remind" label="Напоминание">
            <Select id="ev-remind" name="remindMinutes" defaultValue={target?.remindMinutes != null ? String(target.remindMinutes) : ''}>
              {REMIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" name="allDay" defaultChecked={target?.allDay ?? false} className="h-4 w-4 rounded" />
              <span>Весь день</span>
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field htmlFor="ev-org" label="Организация (необязательно)">
            <Select id="ev-org" name="linkedOrganizationId" defaultValue={target?.linkedOrganizationId ?? ''}>
              <option value="">— не привязана —</option>
              {options.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="ev-order" label="Заявка (необязательно)">
            <Select id="ev-order" name="linkedOrderId" defaultValue={target?.linkedOrderId ?? ''}>
              <option value="">— не привязана —</option>
              {options.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <p className="text-sm font-medium text-[#111111] mb-2">Участники</p>
          {options.users.length === 0 ? (
            <p className="text-xs text-gray-400">Нет доступных сотрудников.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {options.users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    name="attendeeIds"
                    value={u.id}
                    defaultChecked={target?.attendeeIds.includes(u.id) ?? false}
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

'use client';

/**
 * §10 ТЗ v0.5 — экран настройки справочника рабочих статусов заявки.
 *
 * Один компонент на два кабинета (`/admin/order-statuses` и зеркало
 * `/leader/settings/order-statuses`) — тот же приём, что и у настраиваемых
 * полей §11: §4 ТЗ даёт настройку статусов руководителю, а Model A запрещает
 * пускать его в `/admin/*`.
 *
 * Порядок меняется кнопками «выше»/«ниже», а не полем с числом: заказчик
 * мыслит последовательностью стадий, а не значениями sortOrder.
 */

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatusDefinition } from '@prisma/client';
import {
  Button,
  Input,
  Field,
  Dialog,
  TableShell,
  THead,
  Th,
  Tr,
  Td,
  Badge,
} from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';

import { PageHeader } from '@/components/ui/page-header';
/** Пояснение к якорю: что именно ставит статус автоматически. */
const ANCHOR_HINTS: Record<string, string> = {
  paid: 'ставится автоматически, когда поступила оплата',
  documents_issued: 'ставится автоматически, когда переданы документы',
  accounting_signed: 'ставится автоматически, когда бухгалтерия подписала',
  closed: 'ставится автоматически при закрытии заявки',
};

export type OrderStatusesAdminProps = {
  rows: OrderStatusDefinition[];
};

export function OrderStatusesAdmin({ rows }: OrderStatusesAdminProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrderStatusDefinition | null>(null);
  const [isPending, startTransition] = useTransition();

  async function call(url: string, init: RequestInit, failMsg: string): Promise<boolean> {
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', failMsg));
      return false;
    }
    return true;
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label')).trim();
    const key = String(fd.get('key')).trim();
    const maxOrder = rows.reduce((m, r) => Math.max(m, r.sortOrder), 0);

    const ok = await call(
      '/api/admin/order-statuses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Новый статус встаёт в конец: вставку в середину заказчик делает
        // кнопками порядка — так понятнее, чем гадать с числом.
        body: JSON.stringify({ key, label, sortOrder: maxOrder + 1 }),
      },
      'Не удалось добавить статус.'
    );
    if (!ok) return;

    setAddOpen(false);
    toast.success('Статус добавлен.');
    startTransition(() => router.refresh());
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    /* v8 ignore next */
    if (!editTarget) return;
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label')).trim();

    const ok = await call(
      `/api/admin/order-statuses/${editTarget.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      },
      'Не удалось переименовать статус.'
    );
    if (!ok) return;

    setEditTarget(null);
    toast.success('Статус переименован.');
    startTransition(() => router.refresh());
  }

  /** Перестановка: меняем sortOrder местами с соседом. */
  async function move(row: OrderStatusDefinition, direction: -1 | 1) {
    const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((r) => r.id === row.id);
    const neighbour = ordered[idx + direction];
    /* v8 ignore next -- кнопка у края списка не рендерится */
    if (!neighbour) return;

    const okA = await call(
      `/api/admin/order-statuses/${row.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: neighbour.sortOrder }),
      },
      'Не удалось изменить порядок.'
    );
    if (!okA) return;

    const okB = await call(
      `/api/admin/order-statuses/${neighbour.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: row.sortOrder }),
      },
      'Не удалось изменить порядок.'
    );
    if (!okB) return;

    toast.success('Порядок изменён.');
    startTransition(() => router.refresh());
  }

  async function setActive(row: OrderStatusDefinition, isActive: boolean) {
    const ok = await call(
      `/api/admin/order-statuses/${row.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      },
      isActive ? 'Не удалось включить статус.' : 'Не удалось выключить статус.'
    );
    if (!ok) return;
    toast.success(isActive ? 'Статус включён.' : 'Статус выключен.');
    startTransition(() => router.refresh());
  }

  async function remove(row: OrderStatusDefinition) {
    const ok = await call(
      `/api/admin/order-statuses/${row.id}`,
      { method: 'DELETE' },
      'Не удалось удалить статус.'
    );
    if (!ok) return;
    toast.success('Статус удалён.');
    startTransition(() => router.refresh());
  }

  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Статусы заявок"
        subtitle="Порядок статусов — это порядок стадий заявки. Вперёд заявку двигает менеджер, вернуть на предыдущую стадию могут только администратор и руководитель. Семь статусов из технического задания удалить и выключить нельзя."
        action={<Button onClick={() => setAddOpen(true)}>+ Добавить</Button>}
      />

      <TableShell>
        <THead>
          <Th>Порядок</Th>
          <Th>Название</Th>
          <Th>Ключ</Th>
          <Th>Особенности</Th>
          <Th>Активен</Th>
          <Th>Действия</Th>
        </THead>
        <tbody>
          {ordered.length === 0 && (
            <Tr>
              <Td colSpan={6} className="text-center text-gray-400">
                Справочник пуст
              </Td>
            </Tr>
          )}
          {ordered.map((row, idx) => (
            <Tr key={row.id}>
              <Td>
                <div className="flex gap-1">
                  {idx > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      aria-label={`Поднять «${row.label}»`}
                      onClick={() => move(row, -1)}
                    >
                      ↑
                    </Button>
                  )}
                  {idx < ordered.length - 1 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      aria-label={`Опустить «${row.label}»`}
                      onClick={() => move(row, 1)}
                    >
                      ↓
                    </Button>
                  )}
                </div>
              </Td>
              <Td>{row.label}</Td>
              <Td>
                <code className="text-sm text-orange-600">{row.key}</code>
              </Td>
              <Td className="space-x-1">
                {row.isSystem && <Badge tone="info">системный</Badge>}
                {row.isTerminal && <Badge tone="warning">завершающий</Badge>}
                {row.anchor && (
                  <span className="text-xs text-gray-500">{ANCHOR_HINTS[row.anchor]}</span>
                )}
              </Td>
              <Td>
                <Badge tone={row.isActive ? 'success' : 'neutral'}>
                  {row.isActive ? 'Да' : 'Нет'}
                </Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditTarget(row)}>
                    Переименовать
                  </Button>
                  {!row.isSystem && row.isActive && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => setActive(row, false)}
                    >
                      Выключить
                    </Button>
                  )}
                  {!row.isSystem && !row.isActive && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => setActive(row, true)}
                    >
                      Включить
                    </Button>
                  )}
                  {!row.isSystem && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => remove(row)}
                    >
                      Удалить
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Новый статус" size="md">
        <form onSubmit={handleAdd} className="space-y-4">
          <Field htmlFor="add-status-label" label="Название">
            <Input id="add-status-label" name="label" required autoFocus />
          </Field>
          <Field htmlFor="add-status-key" label="Ключ (латиница, a-z0-9_)">
            <Input id="add-status-key" name="key" required pattern="[a-z][a-z0-9_]*" />
          </Field>
          <p className="text-xs text-gray-500">
            Новый статус встанет в конец списка — переставьте его стрелками на нужное место.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button type="submit">Создать</Button>
          </div>
        </form>
      </Dialog>

      <EditStatusDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleEdit}
      />
    </div>
  );
}

function EditStatusDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: OrderStatusDefinition | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  if (!target) return null;

  return (
    <Dialog open={!!target} onClose={onClose} title="Переименовать статус" size="md">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field htmlFor="edit-status-label" label="Название">
          <Input
            id="edit-status-label"
            name="label"
            required
            defaultValue={target.label}
            autoFocus
          />
        </Field>
        <Field htmlFor="edit-status-key" label="Ключ">
          <Input
            id="edit-status-key"
            value={target.key}
            readOnly
            className="bg-gray-50 text-gray-500"
          />
        </Field>
        {target.anchor && (
          <p className="text-xs text-gray-500">
            {ANCHOR_HINTS[target.anchor]}. Название можно менять — связь с событием останется.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Сохранить</Button>
        </div>
      </form>
    </Dialog>
  );
}

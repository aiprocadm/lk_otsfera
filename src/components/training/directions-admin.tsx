'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TrainingDirection } from '@prisma/client';
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
type Props = {
  directions: TrainingDirection[];
};

export function DirectionsAdmin({ directions }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TrainingDirection | null>(null);
  const [isPending, startTransition] = useTransition();

  // ─── Add ────────────────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = (fd.get('name') as string).trim();
    const sortOrder = Number(fd.get('sortOrder') || 0);

    const res = await fetch('/api/admin/training-directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sortOrder }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', 'Не удалось создать направление.'));
      return;
    }

    setAddOpen(false);
    toast.success('Направление добавлено.');
    startTransition(() => router.refresh());
  }

  // ─── Edit ───────────────────────────────────────────────────────────────────

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Defensive guard: unreachable via the UI — the edit <form> (the only
    // caller of handleEdit) is rendered conditionally as `{editTarget && (...)}`.
    /* v8 ignore next -- unreachable: handleEdit's only caller is the edit form, itself gated on `editTarget` truthy */
    if (!editTarget) return;
    const fd = new FormData(e.currentTarget);
    const name = (fd.get('name') as string).trim();
    const sortOrder = Number(fd.get('sortOrder') || 0);

    const res = await fetch(`/api/admin/training-directions/${editTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sortOrder }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', 'Не удалось обновить направление.'));
      return;
    }

    setEditTarget(null);
    toast.success('Направление обновлено.');
    startTransition(() => router.refresh());
  }

  // ─── Deactivate ─────────────────────────────────────────────────────────────

  async function handleDeactivate(id: string) {
    const res = await fetch(`/api/admin/training-directions/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', 'Не удалось деактивировать направление.'));
      return;
    }

    toast.success('Направление деактивировано.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <PageHeader
            title="Направления обучения"
            subtitle="Справочник тем обучения — из него выбирают в заявках и заказах"
          />
        </div>
        <Button onClick={() => setAddOpen(true)}>+ Добавить</Button>
      </div>

      <TableShell>
        <THead>
          <Th>Название</Th>
          <Th>Порядок</Th>
          <Th>Активно</Th>
          <Th>Действия</Th>
        </THead>
        <tbody>
          {directions.length === 0 && (
            <Tr>
              <Td colSpan={4} className="text-center text-gray-400">
                Нет направлений
              </Td>
            </Tr>
          )}
          {directions.map((d) => (
            <Tr key={d.id}>
              <Td>{d.name}</Td>
              <Td>{d.sortOrder}</Td>
              <Td>
                <Badge tone={d.isActive ? 'success' : 'neutral'}>{d.isActive ? 'Да' : 'Нет'}</Badge>
              </Td>
              <Td>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditTarget(d)}>
                    Изменить
                  </Button>
                  {d.isActive && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => handleDeactivate(d.id)}
                    >
                      Деактивировать
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {/* ─── Add dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Новое направление" size="sm">
        <form onSubmit={handleAdd} className="space-y-4">
          <Field htmlFor="add-name" label="Название">
            <Input id="add-name" name="name" required autoFocus />
          </Field>
          <Field htmlFor="add-sort" label="Порядок сортировки">
            <Input id="add-sort" name="sortOrder" type="number" defaultValue={0} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button type="submit">Создать</Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Edit dialog ─────────────────────────────────────────────────────── */}
      <Dialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Изменить направление"
        size="sm"
      >
        {editTarget && (
          <form onSubmit={handleEdit} className="space-y-4">
            <Field htmlFor="edit-name" label="Название">
              <Input id="edit-name" name="name" required defaultValue={editTarget.name} autoFocus />
            </Field>
            <Field htmlFor="edit-sort" label="Порядок сортировки">
              <Input
                id="edit-sort"
                name="sortOrder"
                type="number"
                defaultValue={editTarget.sortOrder}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

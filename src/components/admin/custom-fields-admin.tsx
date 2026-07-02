'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomFieldDefinition, CustomFieldType } from '@prisma/client';
import {
  Button,
  Input,
  Select,
  Field,
  Dialog,
  TableShell,
  THead,
  Th,
  Tr,
  Td,
  Badge,
  Textarea
} from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';

// v1: entityType жёстко задан как 'order'; UI-селектор не нужен.
const ENTITY_TYPE = 'order';

const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Текст' },
  { value: 'number', label: 'Число' },
  { value: 'date', label: 'Дата' },
  { value: 'select', label: 'Список' },
  { value: 'boolean', label: 'Да / Нет' }
];

type Props = {
  definitions: CustomFieldDefinition[];
};

export function CustomFieldsAdmin({ definitions }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomFieldDefinition | null>(null);
  const [isPending, startTransition] = useTransition();

  // ─── Add ────────────────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const label = (fd.get('label') as string).trim();
    const key = (fd.get('key') as string).trim();
    const fieldType = fd.get('fieldType') as CustomFieldType;
    const required = fd.get('required') === 'on';
    const sortOrder = Number(fd.get('sortOrder') || 0);
    const optionsRaw = (fd.get('options') as string | null) ?? '';
    const options = fieldType === 'select'
      ? optionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const res = await fetch('/api/admin/custom-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: ENTITY_TYPE, key, label, fieldType, options, required, sortOrder })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', 'Не удалось создать поле.'));
      return;
    }

    setAddOpen(false);
    toast.success('Поле добавлено.');
    startTransition(() => router.refresh());
  }

  // ─── Edit ───────────────────────────────────────────────────────────────────

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editTarget) return;
    const fd = new FormData(e.currentTarget);
    const label = (fd.get('label') as string).trim();
    const required = fd.get('required') === 'on';
    const sortOrder = Number(fd.get('sortOrder') || 0);
    const optionsRaw = (fd.get('options') as string | null) ?? '';
    const options = editTarget.fieldType === 'select'
      ? optionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const res = await fetch(`/api/admin/custom-fields/${editTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, options, required, sortOrder })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', 'Не удалось обновить поле.'));
      return;
    }

    setEditTarget(null);
    toast.success('Поле обновлено.');
    startTransition(() => router.refresh());
  }

  // ─── Deactivate ─────────────────────────────────────────────────────────────

  async function handleDeactivate(id: string) {
    const res = await fetch(`/api/admin/custom-fields/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(errorMessageRu(body.error ?? '', 'Не удалось деактивировать поле.'));
      return;
    }

    toast.success('Поле деактивировано.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Настраиваемые поля</h1>
        <Button onClick={() => setAddOpen(true)}>+ Добавить</Button>
      </div>

      <TableShell>
        <THead>
          <Th>Название</Th>
          <Th>Ключ</Th>
          <Th>Тип</Th>
          <Th>Обязательное</Th>
          <Th>Активно</Th>
          <Th>Действия</Th>
        </THead>
        <tbody>
          {definitions.length === 0 && (
            <Tr>
              <Td colSpan={6} className="text-center text-gray-400">
                Нет настраиваемых полей
              </Td>
            </Tr>
          )}
          {definitions.map((d) => (
            <Tr key={d.id}>
              <Td>{d.label}</Td>
              <Td>
                <code className="text-sm text-orange-600">{d.key}</code>
              </Td>
              <Td>{FIELD_TYPE_OPTIONS.find((o) => o.value === d.fieldType)?.label ?? d.fieldType}</Td>
              <Td>
                <Badge tone={d.required ? 'warning' : 'neutral'}>
                  {d.required ? 'Да' : 'Нет'}
                </Badge>
              </Td>
              <Td>
                <Badge tone={d.isActive ? 'success' : 'neutral'}>
                  {d.isActive ? 'Да' : 'Нет'}
                </Badge>
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
      <AddFieldDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
      />

      {/* ─── Edit dialog ─────────────────────────────────────────────────────── */}
      <EditFieldDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleEdit}
      />
    </div>
  );
}

// ─── Add dialog sub-component ────────────────────────────────────────────────

function AddFieldDialog({
  open,
  onClose,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');

  return (
    <Dialog open={open} onClose={onClose} title="Новое настраиваемое поле" size="md">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field htmlFor="add-label" label="Название">
          <Input id="add-label" name="label" required autoFocus />
        </Field>
        <Field htmlFor="add-key" label="Ключ (латиница, a-z0-9_)">
          <Input id="add-key" name="key" required pattern="[a-z][a-z0-9_]*" />
        </Field>
        <Field htmlFor="add-fieldType" label="Тип поля">
          <Select
            id="add-fieldType"
            name="fieldType"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
          >
            {FIELD_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        {fieldType === 'select' && (
          <Field htmlFor="add-options" label="Варианты (через запятую)">
            <Textarea id="add-options" name="options" rows={3} required />
          </Field>
        )}
        <Field htmlFor="add-required" label="">
          <label className="flex items-center gap-2 cursor-pointer">
            <input id="add-required" name="required" type="checkbox" className="h-4 w-4 rounded" />
            <span className="text-sm">Обязательное поле</span>
          </label>
        </Field>
        <Field htmlFor="add-sortOrder" label="Порядок сортировки">
          <Input id="add-sortOrder" name="sortOrder" type="number" defaultValue={0} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Создать</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Edit dialog sub-component ───────────────────────────────────────────────

function EditFieldDialog({
  target,
  onClose,
  onSubmit
}: {
  target: CustomFieldDefinition | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  if (!target) return null;

  return (
    <Dialog open={!!target} onClose={onClose} title="Изменить поле" size="md">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field htmlFor="edit-label" label="Название">
          <Input id="edit-label" name="label" required defaultValue={target.label} autoFocus />
        </Field>
        {/* Ключ неизменяем после создания */}
        <Field htmlFor="edit-key-display" label="Ключ">
          <Input id="edit-key-display" value={target.key} readOnly className="bg-gray-50 text-gray-500" />
        </Field>
        {target.fieldType === 'select' && (
          <Field htmlFor="edit-options" label="Варианты (через запятую)">
            <Textarea
              id="edit-options"
              name="options"
              rows={3}
              defaultValue={target.options.join(', ')}
              required
            />
          </Field>
        )}
        <Field htmlFor="edit-required" label="">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              id="edit-required"
              name="required"
              type="checkbox"
              className="h-4 w-4 rounded"
              defaultChecked={target.required}
            />
            <span className="text-sm">Обязательное поле</span>
          </label>
        </Field>
        <Field htmlFor="edit-sortOrder" label="Порядок сортировки">
          <Input id="edit-sortOrder" name="sortOrder" type="number" defaultValue={target.sortOrder} />
        </Field>
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

'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
  EmptyState,
} from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import type { ScopeLevel, Capability, AccessObjectType } from '@/lib/auth/accessProfile';
import type { AccessProfileListRow, AssignableUser } from '@/lib/services/access/profiles';
import { PageHeader } from '@/components/ui/page-header';
import {
  createAccessProfileAction,
  updateAccessProfileAction,
  deleteAccessProfileAction,
  assignUserProfileAction,
} from '@/server-actions/access/profiles';

const SCOPE_OPTIONS: { value: ScopeLevel; label: string }[] = [
  { value: 'own', label: 'Свои' },
  { value: 'assigned', label: 'Закреплённые' },
  { value: 'all', label: 'Все' },
];

const OBJECT_TYPES: { key: AccessObjectType; label: string }[] = [
  { key: 'orders', label: 'Заявки' },
  { key: 'organizations', label: 'Организации' },
  { key: 'threads', label: 'Переписка' },
  { key: 'documents', label: 'Документы' },
  { key: 'finance', label: 'Финансы' },
  { key: 'leads', label: 'Воронка' },
  { key: 'tasks', label: 'Задачи' },
];

const CAPABILITY_OPTIONS: { value: Capability; label: string }[] = [
  { value: 'see_commission', label: 'Видеть комиссию' },
  { value: 'import_1c', label: 'Импорт 1С' },
  { value: 'export', label: 'Экспорт' },
  { value: 'manage_catalog', label: 'Управление каталогом' },
  { value: 'manage_users', label: 'Управление пользователями' },
  { value: 'assign_orders', label: 'Распределение заявок' },
];

const scopeLabel = (v: ScopeLevel) => SCOPE_OPTIONS.find((o) => o.value === v)?.label ?? v;
const capLabel = (v: Capability) => CAPABILITY_OPTIONS.find((o) => o.value === v)?.label ?? v;

type Props = { profiles: AccessProfileListRow[]; users: AssignableUser[] };

type FormState = { mode: 'create' } | { mode: 'edit'; target: AccessProfileListRow } | null;

export function RoleEditor({ profiles, users }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(null);
  const [isPending, startTransition] = useTransition();

  async function handleDelete(row: AccessProfileListRow) {
    const fd = new FormData();
    fd.set('id', row.id);
    const res = await deleteAccessProfileAction(fd);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось удалить роль.'));
      return;
    }
    toast.success('Роль удалена.');
    startTransition(() => router.refresh());
  }

  async function handleAssign(userId: string, profileId: string) {
    const fd = new FormData();
    fd.set('userId', userId);
    fd.set('profileId', profileId);
    const res = await assignUserProfileAction(fd);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось назначить роль.'));
      return;
    }
    toast.success('Роль назначена.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <PageHeader
            title="Роли доступа"
            subtitle="Настраиваемые профили прав: охват по типам объектов + возможности. Системные роли не меняются."
          />
        </div>
        <Button onClick={() => setForm({ mode: 'create' })}>+ Новая роль</Button>
      </div>

      {profiles.length === 0 ? (
        <EmptyState message="Ролей пока нет — создайте первую, чтобы нарезать права внутри компании." />
      ) : (
        <TableShell>
          <THead>
            <Th>Роль</Th>
            <Th>Охваты</Th>
            <Th>Возможности</Th>
            <Th>Пользователей</Th>
            <Th>Действия</Th>
          </THead>
          <tbody>
            {profiles.map((p) => (
              <Tr key={p.id}>
                <Td className="font-medium">{p.name}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {OBJECT_TYPES.map((o) => (
                      <Badge key={o.key} tone="neutral">
                        {o.label}: {scopeLabel(p[o.key])}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {p.capabilities.length === 0 ? (
                      <span className="text-gray-400 text-sm">—</span>
                    ) : (
                      p.capabilities.map((c) => (
                        <Badge key={c} tone="success">
                          {capLabel(c)}
                        </Badge>
                      ))
                    )}
                  </div>
                </Td>
                <Td>{p.usersCount}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setForm({ mode: 'edit', target: p })}
                    >
                      Изменить
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => handleDelete(p)}
                    >
                      Удалить
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#111111]">Назначение ролей сотрудникам</h2>
        {users.length === 0 ? (
          <EmptyState message="Менеджеры компании появятся здесь после добавления." />
        ) : (
          <TableShell>
            <THead>
              <Th>Сотрудник</Th>
              <Th>Email</Th>
              <Th>Роль</Th>
            </THead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="text-gray-500">{u.email}</Td>
                  <Td>
                    <Select
                      aria-label={`Роль сотрудника ${u.name}`}
                      value={u.accessProfileId ?? ''}
                      disabled={isPending}
                      onChange={(e) => handleAssign(u.id, e.target.value)}
                    >
                      <option value="">— без роли (по умолчанию) —</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>

      {form && (
        <RoleFormDialog
          key={form.mode === 'edit' ? form.target.id : 'create'}
          target={form.mode === 'edit' ? form.target : null}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function RoleFormDialog({
  target,
  onClose,
  onSaved,
}: {
  target: AccessProfileListRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    const res = target ? await updateAccessProfileAction(fd) : await createAccessProfileAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить роль.'));
      return;
    }
    toast.success(target ? 'Роль обновлена.' : 'Роль создана.');
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={target ? 'Изменить роль' : 'Новая роль'}
      size="lg"
      busy={submitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="role-name" label="Название роли">
          <Input
            id="role-name"
            name="name"
            required
            maxLength={100}
            defaultValue={target?.name ?? ''}
            autoFocus
          />
        </Field>

        <div>
          <p className="text-sm font-medium text-[#111111] mb-2">Охват по типам объектов</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OBJECT_TYPES.map((o) => (
              <Field key={o.key} htmlFor={`scope-${o.key}`} label={o.label}>
                <Select id={`scope-${o.key}`} name={o.key} defaultValue={target?.[o.key] ?? 'all'}>
                  {SCOPE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-[#111111] mb-2">Возможности</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CAPABILITY_OPTIONS.map((c) => (
              <label key={c.value} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  name="capabilities"
                  value={c.value}
                  defaultChecked={target?.capabilities.includes(c.value) ?? false}
                  className="h-4 w-4 rounded"
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
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

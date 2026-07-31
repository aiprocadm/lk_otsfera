'use client';

/**
 * §11 ТЗ v0.5 — экран настройки дополнительных полей.
 *
 * Один компонент на два кабинета: `/admin/custom-fields` и зеркало
 * `/leader/settings/custom-fields` (§4 ТЗ даёт настройку полей и руководителю,
 * а Model A §4 CLAUDE.md запрещает пускать его в `/admin/*`). Sibling-паттерн
 * здесь неприменим: экран строго административный, домены не расходятся —
 * различается только `basePath` для ссылок вкладок.
 */

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  Textarea,
} from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  type CustomFieldEntity,
} from '@/lib/services/customFields/entities';
import {
  CUSTOM_FIELD_ROLES,
  CUSTOM_FIELD_ROLE_LABELS,
  type CustomFieldRole,
} from '@/lib/services/customFields/roles';
import { FIELD_TYPE_LABELS, requiresOptions } from '@/lib/services/customFields/coerce';
import type { SystemFieldDescriptor } from '@/lib/services/customFields/systemFields';

const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = (
  Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]
).map((value) => ({ value, label: FIELD_TYPE_LABELS[value] }));

/** Роли списком: пустой массив означает «по умолчанию», а не «никому». */
function rolesLabel(roles: string[], fallback: string): string {
  if (roles.length === 0) return fallback;
  return roles
    .filter((r): r is CustomFieldRole => (CUSTOM_FIELD_ROLES as readonly string[]).includes(r))
    .map((r) => CUSTOM_FIELD_ROLE_LABELS[r])
    .join(', ');
}

function parseOptions(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readRoles(fd: FormData, name: string): string[] {
  return fd.getAll(name).map(String);
}

/**
 * Подсказка: пустая строка сохраняется как «нет подсказки», а не как «».
 * Поле всегда есть в обеих формах, поэтому `fd.get` не бывает null — приводим
 * без ветки-заглушки.
 */
function readHelpText(fd: FormData): string | null {
  const value = String(fd.get('helpText')).trim();
  return value === '' ? null : value;
}

export type CustomFieldsAdminProps = {
  /** Сущность, поля которой показываем. */
  entity: CustomFieldEntity;
  /** Определения этой сущности (активные и деактивированные). */
  definitions: CustomFieldDefinition[];
  /** Системные поля §11 — только показ, удалять нельзя. */
  systemFields: SystemFieldDescriptor[];
  /** Базовый путь экрана: `/admin/custom-fields` или `/leader/settings/custom-fields`. */
  basePath: string;
};

export function CustomFieldsAdmin({
  entity,
  definitions,
  systemFields,
  basePath,
}: CustomFieldsAdminProps) {
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
    const helpText = readHelpText(fd);
    const optionsRaw = String(fd.get('options') ?? '');
    const options = requiresOptions(fieldType) ? parseOptions(optionsRaw) : undefined;

    const res = await fetch('/api/admin/custom-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: entity,
        key,
        label,
        fieldType,
        options,
        required,
        sortOrder,
        helpText,
        visibleToRoles: readRoles(fd, 'visibleToRoles'),
        editableByRoles: readRoles(fd, 'editableByRoles'),
      }),
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
    // Defensive fallback: the only caller is the edit form, itself gated on `editTarget` truthy
    // (EditFieldDialog returns null when target is null), so this guard is structurally unreachable.
    /* v8 ignore next */
    if (!editTarget) return;
    const fd = new FormData(e.currentTarget);
    const label = (fd.get('label') as string).trim();
    const required = fd.get('required') === 'on';
    const sortOrder = Number(fd.get('sortOrder') || 0);
    const helpText = readHelpText(fd);
    const optionsRaw = String(fd.get('options') ?? '');
    const options = requiresOptions(editTarget.fieldType) ? parseOptions(optionsRaw) : undefined;

    const res = await fetch(`/api/admin/custom-fields/${editTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        options,
        required,
        sortOrder,
        helpText,
        visibleToRoles: readRoles(fd, 'visibleToRoles'),
        editableByRoles: readRoles(fd, 'editableByRoles'),
      }),
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

      <EntityTabs entity={entity} basePath={basePath} />

      {systemFields.length > 0 && <SystemFieldsBlock fields={systemFields} />}

      <TableShell>
        <THead>
          <Th>Название</Th>
          <Th>Ключ</Th>
          <Th>Тип</Th>
          <Th>Подсказка</Th>
          <Th>Видят</Th>
          <Th>Правят</Th>
          <Th>Обязательное</Th>
          <Th>Активно</Th>
          <Th>Действия</Th>
        </THead>
        <tbody>
          {definitions.length === 0 && (
            <Tr>
              <Td colSpan={9} className="text-center text-gray-400">
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
              <Td>{FIELD_TYPE_LABELS[d.fieldType] ?? d.fieldType}</Td>
              <Td className="text-sm text-gray-500">{d.helpText || '—'}</Td>
              <Td className="text-sm">{rolesLabel(d.visibleToRoles, 'Все, кто видит карточку')}</Td>
              <Td className="text-sm">
                {rolesLabel(d.editableByRoles, 'Администратор, руководитель')}
              </Td>
              <Td>
                <Badge tone={d.required ? 'warning' : 'neutral'}>{d.required ? 'Да' : 'Нет'}</Badge>
              </Td>
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

      <AddFieldDialog open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAdd} />

      <EditFieldDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleEdit}
      />
    </div>
  );
}

// ─── Вкладки сущностей ───────────────────────────────────────────────────────

function EntityTabs({ entity, basePath }: { entity: CustomFieldEntity; basePath: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CUSTOM_FIELD_ENTITIES.map((e) => (
        <Link
          key={e}
          href={`${basePath}?entity=${e}`}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            e === entity ? 'bg-[#F97316] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {CUSTOM_FIELD_ENTITY_LABELS[e]}
        </Link>
      ))}
    </div>
  );
}

// ─── Системные поля §11 ──────────────────────────────────────────────────────

function SystemFieldsBlock({ fields }: { fields: SystemFieldDescriptor[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-[#111111]">Системные поля</h2>
      <p className="text-xs text-gray-500">
        Эти поля заданы в системе: их нельзя удалить, а их ключи заняты — новое поле с таким ключом
        создать не получится.
      </p>
      <ul className="space-y-1">
        {fields.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="neutral">системное</Badge>
            <span className="text-[#111111]">{f.label}</span>
            <code className="text-xs text-gray-500">{f.key}</code>
            <span className="text-xs text-gray-400">— {f.source}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Чекбоксы ролей ──────────────────────────────────────────────────────────

function RoleCheckboxes({
  name,
  idPrefix,
  selected,
  hint,
}: {
  name: string;
  idPrefix: string;
  selected: string[];
  hint: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-3">
        {CUSTOM_FIELD_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              id={`${idPrefix}-${role}`}
              type="checkbox"
              name={name}
              value={role}
              defaultChecked={selected.includes(role)}
              className="h-4 w-4 rounded"
            />
            <span>{CUSTOM_FIELD_ROLE_LABELS[role]}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  );
}

const VISIBLE_HINT = 'Ничего не отмечено — поле видят все, кому доступна сама карточка.';
const EDITABLE_HINT = 'Ничего не отмечено — поле правят администратор и руководитель.';

// ─── Add dialog ──────────────────────────────────────────────────────────────

function AddFieldDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');

  return (
    <Dialog open={open} onClose={onClose} title="Новое настраиваемое поле" size="lg">
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
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {requiresOptions(fieldType) && (
          <Field htmlFor="add-options" label="Варианты (через запятую)">
            <Textarea id="add-options" name="options" rows={3} required />
          </Field>
        )}
        <Field htmlFor="add-helpText" label="Подсказка под полем (необязательно)">
          <Input id="add-helpText" name="helpText" />
        </Field>
        <Field htmlFor="add-visible-admin" label="Кто видит поле">
          <RoleCheckboxes
            name="visibleToRoles"
            idPrefix="add-visible"
            selected={[]}
            hint={VISIBLE_HINT}
          />
        </Field>
        <Field htmlFor="add-editable-admin" label="Кто может заполнять поле">
          <RoleCheckboxes
            name="editableByRoles"
            idPrefix="add-editable"
            selected={[]}
            hint={EDITABLE_HINT}
          />
        </Field>
        <Field htmlFor="add-required" label="">
          <label className="flex items-center gap-2 cursor-pointer">
            <input id="add-required" name="required" type="checkbox" className="h-4 w-4 rounded" />
            <span className="text-sm">Обязательное поле</span>
          </label>
        </Field>
        <Field htmlFor="add-sortOrder" label="Порядок отображения">
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

// ─── Edit dialog ─────────────────────────────────────────────────────────────

function EditFieldDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: CustomFieldDefinition | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  if (!target) return null;

  return (
    <Dialog open={!!target} onClose={onClose} title="Изменить поле" size="lg">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field htmlFor="edit-label" label="Название">
          <Input id="edit-label" name="label" required defaultValue={target.label} autoFocus />
        </Field>
        {/* Ключ и тип неизменяемы после создания */}
        <Field htmlFor="edit-key-display" label="Ключ">
          <Input
            id="edit-key-display"
            value={target.key}
            readOnly
            className="bg-gray-50 text-gray-500"
          />
        </Field>
        <Field htmlFor="edit-type-display" label="Тип поля">
          <Input
            id="edit-type-display"
            value={FIELD_TYPE_LABELS[target.fieldType] ?? target.fieldType}
            readOnly
            className="bg-gray-50 text-gray-500"
          />
        </Field>
        {requiresOptions(target.fieldType) && (
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
        <Field htmlFor="edit-helpText" label="Подсказка под полем (необязательно)">
          <Input id="edit-helpText" name="helpText" defaultValue={target.helpText ?? ''} />
        </Field>
        <Field htmlFor="edit-visible-admin" label="Кто видит поле">
          <RoleCheckboxes
            name="visibleToRoles"
            idPrefix="edit-visible"
            selected={target.visibleToRoles}
            hint={VISIBLE_HINT}
          />
        </Field>
        <Field htmlFor="edit-editable-admin" label="Кто может заполнять поле">
          <RoleCheckboxes
            name="editableByRoles"
            idPrefix="edit-editable"
            selected={target.editableByRoles}
            hint={EDITABLE_HINT}
          />
        </Field>
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
        <Field htmlFor="edit-sortOrder" label="Порядок отображения">
          <Input
            id="edit-sortOrder"
            name="sortOrder"
            type="number"
            defaultValue={target.sortOrder}
          />
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

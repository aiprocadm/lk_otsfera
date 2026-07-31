'use client';

/**
 * §11 ТЗ v0.5 — секция «Дополнительные поля» на карточке любой из пяти
 * сущностей (заявка, организация, партнёр, сотрудник, документ).
 *
 * Компонент строго презентационный и принимает domain-agnostic тип
 * `FieldWithValue`, поэтому sibling-паттерн §4 CLAUDE.md здесь не применяется:
 * версии `partner-*`/`organization-*` разошлись бы копипастой без причины.
 *
 * Право правки приходит с сервера **на каждое поле** (`definition.editable` =
 * доступ к карточке ∧ роль в `editableByRoles`). Поле без права правки
 * показывается значением, а не заблокированным контролом: заблокированный
 * контрол читается как «сломалось», а не как «не ваше».
 */

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select, Textarea, Button } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { saveCustomFieldsAction } from '@/server-actions/customFields';
import type { FieldWithValue } from '@/lib/services/customFields';
import type { CustomFieldEntity } from '@/lib/services/customFields/entities';
import { parseMultiselect, serializeMultiselect } from '@/lib/services/customFields/coerce';

// ─── Показ значения ──────────────────────────────────────────────────────────

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return `${fmtDate(value)}, ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

export function formatValue(fwv: FieldWithValue): string {
  const { value, definition } = fwv;
  if (value === null || value === '') return '—';
  switch (definition.fieldType) {
    case 'boolean':
      return value === 'true' ? 'Да' : 'Нет';
    case 'date':
      return fmtDate(value);
    case 'datetime':
      return formatDateTime(value);
    case 'money':
      return `${value} ₽`;
    case 'multiselect': {
      const parsed = parseMultiselect(value);
      return parsed === null ? value : parsed.join(', ');
    }
    default:
      return value;
  }
}

function ReadOnlyFields({ fields }: { fields: FieldWithValue[] }) {
  return (
    <dl className="space-y-2">
      {fields.map((fwv) => (
        <div key={fwv.definition.id} className="flex gap-2 text-sm">
          <dt className="text-gray-500 min-w-0 shrink-0 basis-40 truncate">
            {fwv.definition.label}
          </dt>
          <dd className="text-[#111111] min-w-0 break-words">{formatValue(fwv)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Подпись поля ────────────────────────────────────────────────────────────

function FieldLabel({ fwv }: { fwv: FieldWithValue }) {
  const { definition: def } = fwv;
  return (
    <label htmlFor={`cf-${def.id}`} className="block text-xs font-medium text-gray-700">
      {def.label}
      {def.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function HelpText({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="text-xs text-gray-500">{text}</p>;
}

// ─── Форма ───────────────────────────────────────────────────────────────────

/** HTML-тип поля ввода для «простых» типов. */
const INPUT_TYPE: Record<string, string> = {
  number: 'number',
  money: 'text',
  date: 'date',
  datetime: 'datetime-local',
  phone: 'tel',
  email: 'email',
  url: 'url',
  text: 'text',
};

function EditForm({
  fields,
  entityType,
  entityId,
}: {
  fields: FieldWithValue[];
  entityType: CustomFieldEntity;
  entityId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const editable = fields.filter((f) => f.definition.editable);
  const readOnly = fields.filter((f) => !f.definition.editable);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const fwv of editable) {
      init[fwv.definition.id] = fwv.value ?? '';
    }
    return init;
  });

  function handleChange(defId: string, val: string) {
    setValues((prev) => ({ ...prev, [defId]: val }));
  }

  function toggleMulti(defId: string, option: string, checked: boolean) {
    setValues((prev) => {
      const current = parseMultiselect(prev[defId] || '[]') ?? [];
      const next = checked ? [...current, option] : current.filter((v) => v !== option);
      return { ...prev, [defId]: next.length === 0 ? '' : serializeMultiselect(next) };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) {
      payload[k] = v === '' ? null : v;
    }
    startTransition(async () => {
      const result = await saveCustomFieldsAction(entityType, entityId, payload);
      if (result.ok) {
        toast.success('Дополнительные поля сохранены.');
        router.refresh();
      } else {
        toast.error(errorMessageRu(result.error));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {editable.map((fwv) => {
        const { definition: def } = fwv;
        // `values` инициализируется из этого же списка (см. useState выше),
        // поэтому ключ всегда есть; `?? ''` — страховка на невозможную форму
        // состояния.
        /* v8 ignore next */
        const val = values[def.id] ?? '';

        if (def.fieldType === 'select') {
          return (
            <div key={def.id} className="space-y-1">
              <FieldLabel fwv={fwv} />
              <Select
                id={`cf-${def.id}`}
                value={val}
                required={def.required}
                disabled={isPending}
                onChange={(e) => handleChange(def.id, e.target.value)}
              >
                <option value="">— выберите —</option>
                {def.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
              <HelpText text={def.helpText} />
            </div>
          );
        }

        if (def.fieldType === 'multiselect') {
          const selected = parseMultiselect(val || '[]') ?? [];
          return (
            <div key={def.id} className="space-y-1">
              <FieldLabel fwv={fwv} />
              <div className="flex flex-wrap gap-3">
                {def.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      id={`cf-${def.id}-${opt}`}
                      type="checkbox"
                      checked={selected.includes(opt)}
                      disabled={isPending}
                      className="h-4 w-4 rounded border-gray-300 text-[#F97316] focus:ring-[#F97316]"
                      onChange={(e) => toggleMulti(def.id, opt, e.target.checked)}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
              <HelpText text={def.helpText} />
            </div>
          );
        }

        if (def.fieldType === 'boolean') {
          return (
            <div key={def.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  id={`cf-${def.id}`}
                  type="checkbox"
                  checked={val === 'true'}
                  disabled={isPending}
                  required={def.required && val === '' ? true : undefined}
                  className="h-4 w-4 rounded border-gray-300 text-[#F97316] focus:ring-[#F97316]"
                  onChange={(e) => handleChange(def.id, e.target.checked ? 'true' : 'false')}
                />
                <label htmlFor={`cf-${def.id}`} className="text-sm text-gray-700">
                  {def.label}
                  {def.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
              </div>
              <HelpText text={def.helpText} />
            </div>
          );
        }

        if (def.fieldType === 'textarea') {
          return (
            <div key={def.id} className="space-y-1">
              <FieldLabel fwv={fwv} />
              <Textarea
                id={`cf-${def.id}`}
                rows={3}
                value={val}
                required={def.required}
                disabled={isPending}
                onChange={(e) => handleChange(def.id, e.target.value)}
              />
              <HelpText text={def.helpText} />
            </div>
          );
        }

        // text | number | money | date | datetime | phone | email | url
        return (
          <div key={def.id} className="space-y-1">
            <FieldLabel fwv={fwv} />
            <Input
              id={`cf-${def.id}`}
              type={INPUT_TYPE[def.fieldType]}
              // Денежная сумма — текстовое поле с числовой клавиатурой: у
              // type=number в браузерах теряется контроль над копейками и
              // ломается ввод запятой.
              inputMode={def.fieldType === 'money' ? 'decimal' : undefined}
              value={val}
              required={def.required}
              disabled={isPending}
              onChange={(e) => handleChange(def.id, e.target.value)}
            />
            <HelpText text={def.helpText} />
          </div>
        );
      })}

      {readOnly.length > 0 && <ReadOnlyFields fields={readOnly} />}

      <div className="pt-1">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Сохранение…' : 'Сохранить поля'}
        </Button>
      </div>
    </form>
  );
}

// ─── Публичный компонент ─────────────────────────────────────────────────────

export type EntityCustomFieldsProps = {
  fields: FieldWithValue[];
  entityType: CustomFieldEntity;
  entityId: string;
  /** Заголовок секции. По умолчанию «Дополнительные поля». */
  title?: string;
};

/**
 * Секция дополнительных полей карточки.
 *
 * Полей нет → секция не рендерится (пустая рамка на карточке только мешает).
 * Ни одного поля с правом правки → показ без формы.
 */
export function EntityCustomFields({
  fields,
  entityType,
  entityId,
  title = 'Дополнительные поля',
}: EntityCustomFieldsProps) {
  if (fields.length === 0) return null;

  const anyEditable = fields.some((f) => f.definition.editable);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-[#111111]">{title}</h2>
      {anyEditable ? (
        <EditForm fields={fields} entityType={entityType} entityId={entityId} />
      ) : (
        <ReadOnlyFields fields={fields} />
      )}
    </div>
  );
}

'use client';

/**
 * «Дополнительные поля» секция на странице детали заказа.
 *
 * Props:
 *   fields   — результат getValuesForEntity (пустой массив → раздел не рендерится)
 *   orderId  — id заказа, передаётся в saveOrderCustomFieldsAction
 *   editable — true для manager/admin/leader; false для organization/partner
 *
 * Рендерится только client-side ('use client'), т.к. форма нужна интерактивность.
 * Чтение всегда можно передавать с сервера — значения уже строки, RSC-граница безопасна.
 */

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select, Button } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { saveOrderCustomFieldsAction } from '@/server-actions/customFields';
import type { FieldWithValue } from '@/lib/services/customFields';

// ─── Read-only display ───────────────────────────────────────────────────────

function formatValue(fwv: FieldWithValue): string {
  const { value, definition } = fwv;
  if (value === null || value === '') return '—';
  switch (definition.fieldType) {
    case 'boolean':
      return value === 'true' ? 'Да' : 'Нет';
    case 'date':
      return fmtDate(value);
    default:
      return value;
  }
}

function ReadOnlyFields({ fields }: { fields: FieldWithValue[] }) {
  return (
    <dl className='space-y-2'>
      {fields.map((fwv) => (
        <div key={fwv.definition.id} className='flex gap-2 text-sm'>
          <dt className='text-gray-500 min-w-0 shrink-0 basis-40 truncate'>
            {fwv.definition.label}
          </dt>
          <dd className='text-[#111111] min-w-0 break-words'>{formatValue(fwv)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Edit form ───────────────────────────────────────────────────────────────

function EditForm({ fields, orderId }: { fields: FieldWithValue[]; orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // initialise controlled state from current values
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const fwv of fields) {
      init[fwv.definition.id] = fwv.value ?? '';
    }
    return init;
  });

  function handleChange(defId: string, val: string) {
    setValues((prev) => ({ ...prev, [defId]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Convert empty strings to null (clear the field)
    const payload: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) {
      payload[k] = v === '' ? null : v;
    }
    startTransition(async () => {
      const result = await saveOrderCustomFieldsAction(orderId, payload);
      if (result.ok) {
        toast.success('Дополнительные поля сохранены.');
        router.refresh();
      } else {
        toast.error(errorMessageRu(result.error));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-3'>
      {fields.map((fwv) => {
        const { definition: def } = fwv;
        // defense-in-depth: `values` is initialised from this same `fields` array (see
        // useState initializer above), so `values[def.id]` is always defined here; the
        // `?? ''` fallback guards a state shape that can't occur in practice.
        /* v8 ignore next */
        const val = values[def.id] ?? '';

        if (def.fieldType === 'select') {
          return (
            <div key={def.id} className='space-y-1'>
              <label htmlFor={`cf-${def.id}`} className='block text-xs font-medium text-gray-700'>
                {def.label}
                {def.required && <span className='text-red-500 ml-0.5'>*</span>}
              </label>
              <Select
                id={`cf-${def.id}`}
                value={val}
                required={def.required}
                disabled={isPending}
                onChange={(e) => handleChange(def.id, e.target.value)}
              >
                <option value=''>— выберите —</option>
                {def.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </div>
          );
        }

        if (def.fieldType === 'boolean') {
          return (
            <div key={def.id} className='flex items-center gap-2'>
              <input
                id={`cf-${def.id}`}
                type='checkbox'
                checked={val === 'true'}
                disabled={isPending}
                required={def.required && val === '' ? true : undefined}
                className='h-4 w-4 rounded border-gray-300 text-[#F97316] focus:ring-[#F97316]'
                onChange={(e) => handleChange(def.id, e.target.checked ? 'true' : 'false')}
              />
              <label htmlFor={`cf-${def.id}`} className='text-sm text-gray-700'>
                {def.label}
                {def.required && <span className='text-red-500 ml-0.5'>*</span>}
              </label>
            </div>
          );
        }

        // text | number | date
        const inputType =
          def.fieldType === 'number' ? 'number' : def.fieldType === 'date' ? 'date' : 'text';

        return (
          <div key={def.id} className='space-y-1'>
            <label htmlFor={`cf-${def.id}`} className='block text-xs font-medium text-gray-700'>
              {def.label}
              {def.required && <span className='text-red-500 ml-0.5'>*</span>}
            </label>
            <Input
              id={`cf-${def.id}`}
              type={inputType}
              value={val}
              required={def.required}
              disabled={isPending}
              onChange={(e) => handleChange(def.id, e.target.value)}
            />
          </div>
        );
      })}

      <div className='pt-1'>
        <Button type='submit' disabled={isPending}>
          {isPending ? 'Сохранение…' : 'Сохранить поля'}
        </Button>
      </div>
    </form>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

export type OrderCustomFieldsProps = {
  fields: FieldWithValue[];
  orderId: string;
  editable: boolean;
};

/**
 * «Дополнительные поля» — секция на странице детали заказа.
 *
 * Рендерит ничего, если definitions нет (graceful empty state).
 * В read-only режиме (editable=false) — definition-list без формы.
 * В edit режиме (editable=true) — форма с контролами по типу поля.
 */
export function OrderCustomFields({ fields, orderId, editable }: OrderCustomFieldsProps) {
  if (fields.length === 0) return null;

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <h2 className='text-sm font-semibold text-[#111111]'>Дополнительные поля</h2>
      {editable ? (
        <EditForm fields={fields} orderId={orderId} />
      ) : (
        <ReadOnlyFields fields={fields} />
      )}
    </div>
  );
}

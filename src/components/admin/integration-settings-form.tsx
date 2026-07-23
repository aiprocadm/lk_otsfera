'use client';

import React from 'react';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';

/**
 * Генерик-форма группы настроек интеграций на /admin/integrations
 * (спека 2026-07-22-integration-settings-wave2 §4). Каждая группа (Telegram /
 * Max / WhatsApp / Mango / IMAP) — свой server-action; поля декларативные.
 * Секрет: значение никогда не приходит с сервера — только факт «задан»;
 * пустое поле при сохранении не затирает сохранённый секрет.
 */

export type IntegrationFormField = {
  /** name инпута — его же читает server-action из FormData. */
  name: string;
  label: string;
  kind: 'text' | 'secret' | 'checkbox' | 'select';
  /** Начальное значение для text/select. */
  initialValue?: string;
  /** Начальное состояние для checkbox. */
  initialChecked?: boolean;
  placeholder?: string;
  /** Варианты для select. */
  options?: { value: string; label: string }[];
  /** Секрет: задан ли (в БД или env). */
  secretSet?: boolean;
  /** Источник секрета — чтобы показать «в конфиге сервера» для env. */
  secretSource?: 'db' | 'env' | 'none';
};

const ERROR_MAP: Record<string, string> = {
  secrets_key_missing:
    'На сервере не задан ключ шифрования (APP_ENCRYPTION_KEY) — секреты сохранять нельзя. Обратитесь к администратору сервера.',
  validation: 'Проверьте заполнение полей.'
};

const inputClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]';

export function IntegrationSettingsForm({
  title,
  description,
  note,
  action,
  fields
}: {
  title: string;
  description: string;
  /** Плашка-примечание (например, про env-флаг включения канала). */
  note?: string;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  fields: IntegrationFormField[];
}) {
  const { formAction, pending, errorText, success } = useFormAction<Record<string, never>>({
    action: action as (fd: FormData) => Promise<ActionResult<Record<string, never>>>,
    errorMap: ERROR_MAP,
    refresh: true
  });

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5">
      <div>
        <h2 className="font-semibold text-[#111111]">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>

      {note && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {note}
        </div>
      )}

      {fields.map((f) =>
        f.kind === 'checkbox' ? (
          <label key={f.name} className="flex items-center gap-2">
            <input
              type="checkbox"
              name={f.name}
              defaultChecked={f.initialChecked}
              className="accent-[#F97316]"
            />
            <span className="text-sm text-[#111111]">{f.label}</span>
          </label>
        ) : (
          <label key={f.name} className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              {f.label}
              {f.kind === 'secret' && f.secretSet && (
                <span className="ml-2 text-xs text-green-700">
                  задан{f.secretSource === 'env' ? ' (в конфиге сервера)' : ''}
                </span>
              )}
            </span>
            {f.kind === 'select' ? (
              <select name={f.name} defaultValue={f.initialValue} className={inputClass}>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.kind === 'secret' ? (
              <input
                type="password"
                name={f.name}
                autoComplete="off"
                placeholder={f.secretSet ? '•••••••• (оставьте пустым, чтобы не менять)' : f.placeholder}
                className={`${inputClass} font-mono`}
              />
            ) : (
              <input
                type="text"
                name={f.name}
                defaultValue={f.initialValue}
                placeholder={f.placeholder}
                className={inputClass}
              />
            )}
          </label>
        )
      )}

      {errorText && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
          {errorText}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2" role="status">
          Настройки сохранены.
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}

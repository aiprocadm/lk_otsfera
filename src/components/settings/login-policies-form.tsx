'use client';

import React from 'react';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';

/**
 * «Безопасность → Политики входа» (`У-129`).
 *
 * Срок жизни кода из письма, число попыток и сроки ссылок были константами в
 * коде: чтобы дать людям больше минуты на ввод кода, требовалась выкладка.
 *
 * Подтверждение спрашивается **всегда**: каждое поле здесь может закрыть вход
 * всем сразу — например ноль попыток или окно в час.
 */

const ERROR_MAP: Record<string, string> = {
  value_out_of_range: 'Значение вне допустимых границ — проверьте поля.',
  validation: 'Проверьте заполнение полей.',
  secrets_key_missing: 'На сервере не задан ключ шифрования.',
};

export type LoginPolicyField = {
  field: string;
  label: string;
  hint: string;
  min: number;
  max: number;
};

export function LoginPoliciesForm({
  fields,
  values,
  action,
}: {
  fields: LoginPolicyField[];
  values: Record<string, string>;
  action: (fd: FormData) => Promise<ActionResult<object>>;
}) {
  const { formAction, pending, errorText, success } = useFormAction({
    action,
    errorMap: ERROR_MAP,
    refresh: true,
  });

  function guarded(fd: FormData) {
    const ok = window.confirm(
      'Изменить правила входа? Ошибка в этих числах может помешать войти всем сотрудникам.'
    );
    if (!ok) return;
    formAction(fd);
  }

  return (
    <form
      action={guarded}
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      data-testid="login-policies-form"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.field} className="block text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">{f.label}</span>
            <input
              type="text"
              name={f.field}
              defaultValue={values[f.field] ?? ''}
              placeholder={f.hint}
              disabled={pending}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
            <span className="block text-[11px] text-gray-400 mt-0.5">
              допустимо от {f.min} до {f.max}
            </span>
          </label>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Пустое поле означает «взять значение сервера, а если и там пусто — стандартное».
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >
          {pending ? 'Сохранение…' : 'Сохранить'}
        </button>
        {success && (
          <span role="status" className="text-sm text-green-700">
            Сохранено.
          </span>
        )}
      </div>

      {errorText && (
        <p role="alert" className="text-sm text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}

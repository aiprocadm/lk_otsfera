'use client';

import React, { useState } from 'react';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';

/**
 * «Автообмен → Параметры» (`У-125`).
 *
 * Раньше режим обмена, таймаут, перекрытие курсора, компания по умолчанию и
 * лимиты докачки правились только в конфиге сервера. Чтобы перевести обмен из
 * теневого режима в боевой, требовался человек с доступом к серверу.
 *
 * Форма — только у администратора: обмен с 1С один на всю платформу, и его
 * параметры задевают все компании сразу (решение `Р-22`). Руководителю тот же
 * набор показывается на чтение.
 */

export type OneCParamsValues = {
  mode: string;
  httpTimeoutMs: string;
  cursorOverlapMinutes: string;
  defaultCompanyId: string;
  pendingMaxAttempts: string;
  pendingMaxAgeDays: string;
};

export type CompanyOption = { id: string; name: string };

const ERROR_MAP: Record<string, string> = {
  value_out_of_range: 'Проверьте числовые поля — значение вне допустимых границ.',
  secrets_key_missing: 'На сервере не задан ключ шифрования.',
  validation: 'Проверьте заполнение полей.',
};

const inputClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]';

export function OneCParamsForm({
  initial,
  companies,
  action,
}: {
  initial: OneCParamsValues;
  companies: CompanyOption[];
  action: (fd: FormData) => Promise<ActionResult<object>>;
}) {
  const [mode, setMode] = useState(initial.mode);
  const { formAction, pending, errorText, success } = useFormAction({
    action,
    errorMap: ERROR_MAP,
    refresh: true,
  });

  // Переключение в боевой режим — единственное действие формы, у которого
  // последствия видны не здесь, а в 1С: программа начнёт писать туда по--
  // настоящему. Поэтому спрашиваем подтверждение, а не полагаемся на
  // внимательность.
  const goingLive = mode === 'live' && initial.mode !== 'live';

  function guarded(fd: FormData) {
    if (goingLive) {
      const ok = window.confirm(
        'Включить боевой режим обмена? Программа начнёт записывать данные в 1С по-настоящему, ' +
          'а не только читать их.'
      );
      if (!ok) return;
    }
    formAction(fd);
  }

  return (
    <form
      action={guarded}
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      data-testid="onec-params-form"
    >
      <h2 className="text-sm font-semibold text-[#111111]">Параметры обмена</h2>

      <label className="block text-sm text-gray-700">
        <span className="block text-xs text-gray-500 mb-1">Режим</span>
        <select
          name="onec_mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          disabled={pending}
          className={inputClass}
        >
          <option value="shadow">Теневой — только читаем, в 1С не пишем</option>
          <option value="live">Боевой — читаем и пишем</option>
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        <span className="block text-xs text-gray-500 mb-1">
          Компания по умолчанию для сетевого обмена
        </span>
        <select
          name="onec_defaultCompanyId"
          defaultValue={initial.defaultCompanyId}
          disabled={pending}
          className={inputClass}
        >
          <option value="">Не выбрана — новые организации создаваться не будут</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Таймаут запроса, мс</span>
          <input
            type="text"
            name="onec_httpTimeoutMs"
            defaultValue={initial.httpTimeoutMs}
            placeholder="15000"
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="block text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Перекрытие курсора, минут</span>
          <input
            type="text"
            name="onec_cursorOverlapMinutes"
            defaultValue={initial.cursorOverlapMinutes}
            placeholder="5"
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="block text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Попыток докачки записи</span>
          <input
            type="text"
            name="onec_pendingMaxAttempts"
            defaultValue={initial.pendingMaxAttempts}
            placeholder="50"
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="block text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Держать запись в очереди, дней</span>
          <input
            type="text"
            name="onec_pendingMaxAgeDays"
            defaultValue={initial.pendingMaxAgeDays}
            placeholder="7"
            disabled={pending}
            className={inputClass}
          />
        </label>
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

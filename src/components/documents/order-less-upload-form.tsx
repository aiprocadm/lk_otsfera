'use client';

import React, { useRef, useState } from 'react';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { toast } from '@/lib/ui/toast';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

/**
 * «Загрузить общий документ» — один компонент на кабинеты заказчика и партнёра
 * (`У-115`, решение `Р-23`).
 *
 * Форма была только у заказчика: партнёр мог приложить файл лишь к конкретному
 * заказу, а общий документ (договор, свидетельство) приложить было некуда.
 * Раздел один и тот же, значит и экран должен быть один — §0.2 «правило
 * зеркала».
 *
 * Компонент строго презентационный: адрес роута, скрытые поля и словарь ошибок
 * приходят пропсами, а права и скоуп остаются в сервисе своей роли (§4).
 *
 * Роут, а не server action: у server actions общий предел тела 25 МБ, и файл
 * больше него отбрасывался ДО входа в действие — форма молчала, хотя подсказка
 * обещает {DEFAULT_MAX_FILE_SIZE_MB} МБ.
 */

const DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' },
];

export function OrderLessUploadForm({
  url,
  fields,
  errorMap,
}: {
  /** Адрес API-роута своей роли. */
  url: string;
  /** Скрытые поля, которые роут ждёт помимо файла и типа (например `organizationId`). */
  fields?: Record<string, string>;
  /** Коды ошибок → русские строки, специфичные для роли. */
  errorMap?: Record<string, string>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [localError, setLocalError] = useState<string | null>(null);
  const lastFileNameRef = useRef<string>('');

  const { formAction, pending, errorText } = useFetchSubmit<{ documentId: string }>({
    url,
    body: () => {
      const formData = new FormData();
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        formData.set('file', file);
        lastFileNameRef.current = file.name;
      }
      for (const [k, v] of Object.entries(fields ?? {})) formData.set(k, v);
      // orderId не отправляется — это и есть ветка «документ без заказа».
      formData.set('docType', docType);
      return formData;
    },
    ...(errorMap ? { errorMap } : {}),
    refresh: true,
    onSuccess: () => {
      toast.success(`Документ «${lastFileNameRef.current}» загружен.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  // Проверки до отправки: пустой выбор или файл сверх предела не должны уходить
  // на сервер — человек видит строку сразу, а не после сотен мегабайт.
  function guardedAction(formData: FormData) {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setLocalError('Файл не выбран.');
      return;
    }
    if (file.size > DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024) {
      setLocalError(`Файл больше предела в ${DEFAULT_MAX_FILE_SIZE_MB} МБ — выберите поменьше.`);
      return;
    }
    setLocalError(null);
    formAction(formData);
  }

  const error = localError ?? errorText;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#111111] mb-3">Загрузить общий документ</h2>
      <form action={guardedAction} className="flex flex-col gap-3">
        <label className="text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Файл</span>
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            disabled={pending}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50"
          />
        </label>

        <label className="text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Тип документа</span>
          <select
            name="docType"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={pending}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50"
          >
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Загрузка…' : 'Загрузить'}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <p className="text-xs text-gray-400">
          Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум {DEFAULT_MAX_FILE_SIZE_MB}{' '}
          МБ.
        </p>
      </form>
    </div>
  );
}

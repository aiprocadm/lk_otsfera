'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client-side multipart upload form for the manager-side order detail page.
 *
 * Mirrors the org-side upload UX from Phase 7: file picker + document-type
 * select, single submit button with pending state, inline error/success
 * messaging. POSTs to `/api/manager/documents/[id]/upload`. On success
 * we `router.refresh()` so the documents block re-renders from the server.
 *
 * The type options mirror prisma/schema.prisma `enum DocumentType` 1:1; keep
 * this list in sync with the enum (same pattern as
 * `src/app/manager/documents/page.tsx`).
 */

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'other', label: 'Прочее' }
];

const ERROR_LABEL_RU: Record<string, string> = {
  no_file: 'Файл не выбран.',
  too_large: 'Файл превышает максимально допустимый размер 20 МБ.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  forbidden: 'Нет прав на загрузку для этого заказа.',
  not_found: 'Заказ не найден.',
  storage: 'Не удалось загрузить файл в хранилище. Попробуйте ещё раз.',
  network: 'Сетевая ошибка. Проверьте соединение и попробуйте снова.'
};

type Props = {
  orderId: string;
};

export function ManagerDocUploadForm({ orderId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('other');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError(ERROR_LABEL_RU.no_file ?? 'Файл не выбран.');
      return;
    }

    const formData = new FormData();
    formData.set('file', file);
    formData.set('docType', docType);

    setIsPending(true);
    try {
      const res = await fetch(
        `/api/manager/documents/${encodeURIComponent(orderId)}/upload`,
        { method: 'POST', body: formData }
      );

      if (res.status === 201) {
        setSuccess(`Документ «${file.name}» загружен.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
        return;
      }

      // Try to parse a structured error; fall back to a generic message.
      let errCode: string | null = null;
      try {
        const body = (await res.json()) as { error?: string };
        if (typeof body?.error === 'string') errCode = body.error;
      } catch {
        errCode = null;
      }
      setError(
        (errCode && ERROR_LABEL_RU[errCode]) ??
          `Ошибка загрузки (код ${res.status}).`
      );
    } catch {
      setError(ERROR_LABEL_RU.network ?? 'Сетевая ошибка.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>
        Загрузить документ
      </h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Файл</span>
          <input
            ref={fileInputRef}
            type='file'
            disabled={isPending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </label>

        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Тип документа</span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={isPending}
            className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50'
          >
            {DOC_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <button
            type='submit'
            disabled={isPending}
            className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            {isPending ? 'Загружаю…' : 'Загрузить'}
          </button>
        </div>

        {error && (
          <p role='alert' className='text-sm text-red-600'>
            {error}
          </p>
        )}
        {success && (
          <p role='status' className='text-sm text-emerald-600'>
            {success}
          </p>
        )}

        <p className='text-xs text-gray-400'>
          Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.
        </p>
      </form>
    </div>
  );
}

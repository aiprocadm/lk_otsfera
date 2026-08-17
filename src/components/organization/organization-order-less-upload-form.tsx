'use client';

import React, { useRef, useState } from 'react';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { toast } from '@/lib/ui/toast';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

/**
 * Order-less upload form of the organization documents page (a general
 * document pinned to the organization, no orderId sent → order-less branch).
 * POSTs to /api/organization/documents/upload — an API route, not a server
 * action: server actions share the global 25 MB bodySizeLimit and silently
 * dropped bigger files while the hint below promises DOCUMENT_MAX_FILE_SIZE_MB.
 */

const DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' },
];

// not_found здесь означает «организация не найдена», а не «заказ» (order-less ветка).
const ERROR_MAP: Record<string, string> = {
  not_found: 'Организация не найдена.',
};

export function OrganizationOrderLessUploadForm({ organizationId }: { organizationId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [localError, setLocalError] = useState<string | null>(null);
  const lastFileNameRef = useRef<string>('');

  const { formAction, pending, errorText } = useFetchSubmit<{ documentId: string }>({
    url: '/api/organization/documents/upload',
    body: () => {
      const formData = new FormData();
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        formData.set('file', file);
        lastFileNameRef.current = file.name;
      }
      formData.set('organizationId', organizationId);
      // no orderId → order-less branch
      formData.set('docType', docType);
      return formData;
    },
    errorMap: ERROR_MAP,
    refresh: true,
    onSuccess: () => {
      toast.success(`Документ «${lastFileNameRef.current}» загружен.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  // Pre-submit guards: an empty picker or an over-limit file should not POST —
  // surface the inline message instead of shipping hundreds of megabytes.
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

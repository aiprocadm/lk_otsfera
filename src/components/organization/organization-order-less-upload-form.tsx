'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadOrganizationDocument } from '@/server-actions/organization/documents';

const DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' }
];

const ERROR_LABEL_RU: Record<string, string> = {
  validation: 'Проверьте поля формы.',
  forbidden: 'Нет прав на загрузку.',
  not_found: 'Организация не найдена.',
  too_large: 'Файл превышает 20 МБ.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  storage: 'Не удалось загрузить файл. Попробуйте ещё раз.'
};

export function OrganizationOrderLessUploadForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError('Файл не выбран.'); return; }
    const formData = new FormData();
    formData.set('organizationId', organizationId);
    // no orderId → order-less branch
    formData.set('docType', docType);
    formData.set('file', file);
    setIsPending(true);
    try {
      const res = await uploadOrganizationDocument(formData);
      if (res.ok) {
        setSuccess(`Документ «${file.name}» загружен.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
      } else {
        setError(ERROR_LABEL_RU[res.error] ?? 'Ошибка загрузки.');
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Загрузить общий документ</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Файл</span>
          <input
            ref={fileInputRef}
            type='file'
            name='file'
            disabled={isPending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </label>

        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Тип документа</span>
          <select
            name='docType'
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={isPending}
            className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50'
          >
            {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <div>
          <button
            type='submit'
            disabled={isPending}
            className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            {isPending ? 'Загрузка…' : 'Загрузить'}
          </button>
        </div>

        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
        {success && <p role='status' className='text-sm text-emerald-600'>{success}</p>}

        <p className='text-xs text-gray-400'>
          Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.
        </p>
      </form>
    </div>
  );
}

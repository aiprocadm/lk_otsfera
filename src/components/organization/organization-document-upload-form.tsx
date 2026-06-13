'use client';

import { useRef, useState } from 'react';
import { uploadOrganizationDocument } from '@/server-actions/organization/documents';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' }
];

export function OrganizationDocumentUploadForm({ organizationId, orderId }: { organizationId: string; orderId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  // Имя файла фиксируем на сабмите: useActionState сбрасывает file-input до onSuccess.
  const lastFileNameRef = useRef<string>('');

  const { formAction, pending, errorText } = useFormAction<{ documentId: string }>({
    action: uploadOrganizationDocument,
    refresh: true,
    onSuccess: () => {
      toast.success(`Документ «${lastFileNameRef.current}» отправлен менеджеру.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  });

  function action(formData: FormData) {
    formData.set('organizationId', organizationId);
    formData.set('orderId', orderId);
    formData.set('docType', docType);
    const file = formData.get('file');
    lastFileNameRef.current = file instanceof File ? file.name : '';
    return formAction(formData);
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Отправить документ менеджеру</h2>
      <form action={action} className='flex flex-col gap-3'>
        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Файл</span>
          <input
            ref={fileInputRef}
            type='file'
            name='file'
            disabled={pending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </label>

        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Тип документа</span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={pending}
            className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50'
          >
            {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <div>
          <button
            type='submit'
            disabled={pending}
            className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            {pending ? 'Отправляю…' : 'Отправить'}
          </button>
        </div>

        {errorText && <p role='alert' className='text-sm text-red-600'>{errorText}</p>}

        <p className='text-xs text-gray-400'>
          Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.
        </p>
      </form>
    </div>
  );
}

'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadPartnerDocument } from '@/server-actions/partner/documents';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';

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

export function PartnerDocumentUploadForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError(errorMessageRu('no_file')); return; }
    const formData = new FormData();
    formData.set('orderId', orderId);
    formData.set('docType', docType);
    formData.set('file', file);
    setIsPending(true);
    try {
      const res = await uploadPartnerDocument(formData);
      if (res.ok) {
        toast.success(`Документ «${file.name}» отправлен менеджеру.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
      } else {
        setError(errorMessageRu(res.error, 'Ошибка загрузки.'));
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Отправить документ менеджеру</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <Field htmlFor='partner-doc-file' label='Файл' hint='Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.'>
          <input
            id='partner-doc-file'
            ref={fileInputRef}
            type='file'
            disabled={isPending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </Field>

        <Field htmlFor='partner-doc-type' label='Тип документа'>
          <Select
            id='partner-doc-type'
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={isPending}
          >
            {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>

        <div>
          <Button type='submit' loading={isPending}>
            {isPending ? 'Отправляю…' : 'Отправить'}
          </Button>
        </div>

        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
      </form>
    </div>
  );
}

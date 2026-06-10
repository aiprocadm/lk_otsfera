'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';

/**
 * Client-side multipart upload form for the manager-side order detail page.
 * POSTs to /api/manager/documents/[id]/upload. The recipient select defaults to
 * 'organization' and auto-switches to 'partner' for 'commission_statement'.
 * Type options mirror prisma DocumentType 1:1 — keep in sync (same as
 * src/app/manager/documents/page.tsx).
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

type Props = { orderId: string };

export function ManagerDocUploadForm({ orderId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('other');
  const [recipient, setRecipient] = useState<'organization' | 'partner'>('organization');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onDocTypeChange(value: string) {
    setDocType(value);
    setRecipient(value === 'commission_statement' ? 'partner' : 'organization');
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError(errorMessageRu('no_file')); return; }

    const formData = new FormData();
    formData.set('file', file);
    formData.set('docType', docType);
    formData.set('recipient', recipient);

    setIsPending(true);
    try {
      const res = await fetch(
        `/api/manager/documents/${encodeURIComponent(orderId)}/upload`,
        { method: 'POST', body: formData }
      );

      if (res.status === 201) {
        toast.success(`Документ «${file.name}» загружен.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
        return;
      }

      let errCode: string | null = null;
      try {
        const body = (await res.json()) as { error?: string };
        if (typeof body?.error === 'string') errCode = body.error;
      } catch {
        errCode = null;
      }
      setError(errCode ? errorMessageRu(errCode, `Ошибка загрузки (код ${res.status}).`) : `Ошибка загрузки (код ${res.status}).`);
    } catch {
      setError(errorMessageRu('network'));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Загрузить документ</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <Field htmlFor='mgr-doc-file' label='Файл' hint='Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.'>
          <input
            id='mgr-doc-file'
            ref={fileInputRef}
            type='file'
            disabled={isPending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </Field>

        <Field htmlFor='mgr-doc-type' label='Тип документа'>
          <Select id='mgr-doc-type' value={docType} onChange={(e) => onDocTypeChange(e.target.value)} disabled={isPending}>
            {DOC_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </Select>
        </Field>

        <Field htmlFor='mgr-doc-recipient' label='Получатель'>
          <Select
            id='mgr-doc-recipient'
            value={recipient}
            onChange={(e) => setRecipient(e.target.value as 'organization' | 'partner')}
            disabled={isPending}
          >
            <option value='organization'>Организация</option>
            <option value='partner'>Партнёр</option>
          </Select>
        </Field>

        <div>
          <Button type='submit' loading={isPending}>
            {isPending ? 'Загружаю…' : 'Загрузить'}
          </Button>
        </div>

        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
      </form>
    </div>
  );
}

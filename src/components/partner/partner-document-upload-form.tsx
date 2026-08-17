'use client';

import React, { useRef, useState } from 'react';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { toast } from '@/lib/ui/toast';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

/**
 * Client-side multipart upload form for the partner deal detail page.
 * POSTs to /api/partner/documents/upload — an API route, not a server action:
 * server actions share the global 25 MB bodySizeLimit and silently dropped
 * bigger files while the app promises DOCUMENT_MAX_FILE_SIZE_MB.
 */

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' },
];

export function PartnerDocumentUploadForm({ orderId }: { orderId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [localError, setLocalError] = useState<string | null>(null);
  const lastFileNameRef = useRef<string>('');

  const { formAction, pending, errorText } = useFetchSubmit<{ documentId: string }>({
    url: '/api/partner/documents/upload',
    body: () => {
      const formData = new FormData();
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        formData.set('file', file);
        lastFileNameRef.current = file.name;
      }
      formData.set('orderId', orderId);
      formData.set('docType', docType);
      return formData;
    },
    refresh: true,
    onSuccess: () => {
      toast.success(`Документ «${lastFileNameRef.current}» отправлен менеджеру.`);
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
      <h2 className="text-sm font-semibold text-[#111111] mb-3">Отправить документ менеджеру</h2>
      <form action={guardedAction} className="flex flex-col gap-3">
        <Field
          htmlFor="partner-doc-file"
          label="Файл"
          hint={`Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум ${DEFAULT_MAX_FILE_SIZE_MB} МБ.`}
        >
          <input
            id="partner-doc-file"
            name="file"
            ref={fileInputRef}
            type="file"
            disabled={pending}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50"
          />
        </Field>

        <Field htmlFor="partner-doc-type" label="Тип документа">
          <Select
            id="partner-doc-type"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={pending}
          >
            {DOC_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <Button type="submit" loading={pending}>
            {pending ? 'Отправляю…' : 'Отправить'}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

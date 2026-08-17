'use client';

import React, { useRef, useState } from 'react';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { toast } from '@/lib/ui/toast';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

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
  { value: 'other', label: 'Прочее' },
];

type Props = { orderId: string };

export function ManagerDocUploadForm({ orderId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('other');
  const [recipient, setRecipient] = useState<'organization' | 'partner'>('organization');
  const [localError, setLocalError] = useState<string | null>(null);
  const lastFileNameRef = useRef<string>('');

  const { formAction, pending, errorText } = useFetchSubmit({
    url: `/api/manager/documents/${encodeURIComponent(orderId)}/upload`,
    body: () => {
      const formData = new FormData();
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        formData.set('file', file);
        lastFileNameRef.current = file.name;
      }
      formData.set('docType', docType);
      formData.set('recipient', recipient);
      return formData;
    },
    onSuccess: () => {
      toast.success(`Документ «${lastFileNameRef.current}» загружен.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    refresh: true,
  });

  function onDocTypeChange(value: string) {
    setDocType(value);
    setRecipient(value === 'commission_statement' ? 'partner' : 'organization');
  }

  // Pre-submit guard: an empty file picker should not POST. Intercept the native
  // form-action when no file is chosen and surface the inline message instead.
  function guardedAction(formData: FormData) {
    if (!fileInputRef.current?.files?.[0]) {
      setLocalError('Файл не выбран.');
      return;
    }
    setLocalError(null);
    formAction(formData);
  }

  const error = localError ?? errorText;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#111111] mb-3">Загрузить документ</h2>
      <form action={guardedAction} className="flex flex-col gap-3">
        <Field
          htmlFor="mgr-doc-file"
          label="Файл"
          hint={`Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум ${DEFAULT_MAX_FILE_SIZE_MB} МБ.`}
        >
          <input
            id="mgr-doc-file"
            ref={fileInputRef}
            type="file"
            disabled={pending}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50"
          />
        </Field>

        <Field htmlFor="mgr-doc-type" label="Тип документа">
          <Select
            id="mgr-doc-type"
            value={docType}
            onChange={(e) => onDocTypeChange(e.target.value)}
            disabled={pending}
          >
            {DOC_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field htmlFor="mgr-doc-recipient" label="Получатель">
          <Select
            id="mgr-doc-recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value as 'organization' | 'partner')}
            disabled={pending}
          >
            <option value="organization">Организация</option>
            <option value="partner">Партнёр</option>
          </Select>
        </Field>

        <div>
          <Button type="submit" loading={pending}>
            {pending ? 'Загружаю…' : 'Загрузить'}
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

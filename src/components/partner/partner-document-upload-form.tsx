'use client';

import React, { useRef, useState } from 'react';
import { uploadPartnerDocument } from '@/server-actions/partner/documents';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
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
  { value: 'other', label: 'Прочее' },
];

export function PartnerDocumentUploadForm({ orderId }: { orderId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  // Имя файла фиксируем на сабмите: useActionState сбрасывает file-input до onSuccess.
  const lastFileNameRef = useRef<string>('');

  const { formAction, pending, errorText } = useFormAction<{ documentId: string }>({
    action: uploadPartnerDocument,
    refresh: true,
    onSuccess: () => {
      toast.success(`Документ «${lastFileNameRef.current}» отправлен менеджеру.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  function action(formData: FormData) {
    formData.set('orderId', orderId);
    formData.set('docType', docType);
    const file = formData.get('file');
    // A <form>'s FormData always yields a File for a file input — the spec (and jsdom) synthesize
    // an empty-name placeholder File when nothing is selected, never null/string — so the ': ''"
    // branch is structurally unreachable via the rendered form (defensive fallback only).
    /* v8 ignore next */
    lastFileNameRef.current = file instanceof File ? file.name : '';
    return formAction(formData);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#111111] mb-3">Отправить документ менеджеру</h2>
      <form action={action} className="flex flex-col gap-3">
        <Field
          htmlFor="partner-doc-file"
          label="Файл"
          hint="Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ."
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

        {errorText && (
          <p role="alert" className="text-sm text-red-600">
            {errorText}
          </p>
        )}
      </form>
    </div>
  );
}

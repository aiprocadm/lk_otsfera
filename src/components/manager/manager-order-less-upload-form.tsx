'use client';
import React, { useState } from 'react';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

type Option = { id: string; name: string };
const DOC_TYPES = [
  { value: 'contract', label: 'Договор' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'other', label: 'Прочее' },
];

export function ManagerOrderLessUploadForm({
  organizations,
  partners,
}: {
  organizations: Option[];
  partners: Option[];
}) {
  const [type, setType] = useState<'organization' | 'partner'>('organization');
  const [ok, setOk] = useState(false);
  const options = type === 'organization' ? organizations : partners;

  const { formAction, pending, errorText } = useFetchSubmit({
    url: '/api/manager/documents/order-less',
    body: (fd) => fd,
    errorMap: { http_400: 'Не удалось загрузить', http_500: 'Не удалось загрузить' },
    onSuccess: () => {
      setOk(true);
      setType('organization');
    },
    refresh: true,
  });

  function submit(fd: FormData) {
    setOk(false);
    formAction(fd);
  }

  return (
    <form action={submit} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="font-medium text-[#111111] text-sm">Загрузить общий документ</div>
      <div className="flex gap-2">
        <div className="flex flex-col gap-0.5">
          <label htmlFor="orderless-counterparty-type" className="text-xs text-gray-500">
            Тип контрагента
          </label>
          <select
            id="orderless-counterparty-type"
            name="counterpartyType"
            value={type}
            onChange={(e) => setType(e.target.value as 'organization' | 'partner')}
            className="border border-gray-200 rounded px-2 py-1 text-sm"
          >
            <option value="organization">Организация</option>
            <option value="partner">Партнёр</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label htmlFor="orderless-counterparty-id" className="text-xs text-gray-500">
            Контрагент
          </label>
          <select
            id="orderless-counterparty-id"
            name="counterpartyId"
            required
            className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <label htmlFor="orderless-doc-type" className="text-xs text-gray-500">
          Тип документа
        </label>
        <select
          id="orderless-doc-type"
          name="docType"
          defaultValue="other"
          className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-0.5">
        <label htmlFor="orderless-file" className="text-xs text-gray-500">
          Файл
        </label>
        <input
          id="orderless-file"
          type="file"
          name="file"
          required
          className="block w-full text-sm"
        />
      </div>
      <p className="text-xs text-gray-400">PDF, JPG, PNG, DOCX, XLSX · до 20 МБ</p>
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-1.5 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C] disabled:opacity-50"
      >
        {pending ? 'Загрузка…' : 'Загрузить'}
      </button>
      {errorText && (
        <div role="alert" className="text-sm text-red-700">
          {errorText}
        </div>
      )}
      {ok && !errorText && (
        <div role="status" className="text-sm text-green-700">
          Документ загружен
        </div>
      )}
    </form>
  );
}

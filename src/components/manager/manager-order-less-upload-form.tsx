'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

type Option = { id: string; name: string };
const DOC_TYPES = [
  { value: 'contract', label: 'Договор' }, { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' }, { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'other', label: 'Прочее' }
];

export function ManagerOrderLessUploadForm({ organizations, partners }: { organizations: Option[]; partners: Option[] }) {
  const router = useRouter();
  const [type, setType] = useState<'organization' | 'partner'>('organization');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = type === 'organization' ? organizations : partners;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const res = await fetch('/api/manager/documents/order-less', { method: 'POST', body: fd });
    setBusy(false);
    if (res.ok) { setMsg({ kind: 'ok', text: 'Документ загружен' }); form.reset(); router.refresh(); }
    else setMsg({ kind: 'err', text: 'Не удалось загрузить' });
  }

  return (
    <form onSubmit={onSubmit} className='bg-white border border-gray-200 rounded-xl p-4 space-y-3'>
      <div className='font-medium text-[#111111] text-sm'>Загрузить общий документ</div>
      <div className='flex gap-2'>
        <div className='flex flex-col gap-0.5'>
          <label htmlFor='orderless-counterparty-type' className='text-xs text-gray-500'>Тип контрагента</label>
          <select id='orderless-counterparty-type' name='counterpartyType' value={type}
            onChange={(e) => setType(e.target.value as 'organization' | 'partner')}
            className='border border-gray-200 rounded px-2 py-1 text-sm'>
            <option value='organization'>Организация</option>
            <option value='partner'>Партнёр</option>
          </select>
        </div>
        <div className='flex flex-col gap-0.5 flex-1'>
          <label htmlFor='orderless-counterparty-id' className='text-xs text-gray-500'>Контрагент</label>
          <select id='orderless-counterparty-id' name='counterpartyId' required
            className='border border-gray-200 rounded px-2 py-1 text-sm w-full'>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <div className='flex flex-col gap-0.5'>
        <label htmlFor='orderless-doc-type' className='text-xs text-gray-500'>Тип документа</label>
        <select id='orderless-doc-type' name='docType' defaultValue='other'
          className='border border-gray-200 rounded px-2 py-1 text-sm w-full'>
          {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div className='flex flex-col gap-0.5'>
        <label htmlFor='orderless-file' className='text-xs text-gray-500'>Файл</label>
        <input id='orderless-file' type='file' name='file' required className='block w-full text-sm' />
      </div>
      <p className='text-xs text-gray-400'>PDF, JPG, PNG, DOCX, XLSX · до 20 МБ</p>
      <button type='submit' disabled={busy} className='px-3 py-1.5 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C] disabled:opacity-50'>
        {busy ? 'Загрузка…' : 'Загрузить'}
      </button>
      {msg && <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</div>}
    </form>
  );
}

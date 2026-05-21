'use client';
import { useState } from 'react';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

const TYPE_LABELS: Record<string, string> = {
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение',
  invoice: 'Счёт',
  act: 'Акт',
  waybill: 'Накладная',
  certificate: 'Сертификат',
  report: 'Отчёт',
  commission_statement: 'Расчёт комиссии',
  other: 'Прочее'
};

function fmtSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function DocumentsList({ rows }: { rows: OrgDocumentRow[] }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(docId: string, name: string) {
    setError(null);
    setDownloading(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/download`, { method: 'POST' });
      if (!res.ok) {
        setError('Не удалось получить ссылку для скачивания');
        return;
      }
      const body = (await res.json()) as { downloadUrl?: string };
      if (!body.downloadUrl) {
        setError('Ссылка не вернулась — попробуйте ещё раз');
        return;
      }
      const a = document.createElement('a');
      a.href = body.downloadUrl;
      a.download = name;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>📄</span>
        </div>
        <p className='text-gray-500 text-sm'>Документов по выбранному фильтру нет</p>
      </div>
    );
  }

  return (
    <div className='space-y-2'>
      {error && (
        <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
          {error}
        </div>
      )}

      <ul className='bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden'>
        {rows.map((doc) => (
          <li key={doc.id} className='px-4 py-3 flex items-center gap-3 hover:bg-gray-50'>
            <div className='w-10 h-10 bg-[#FFF7ED] rounded-lg flex items-center justify-center flex-shrink-0'>
              <span className='text-lg'>{iconForType(doc.type)}</span>
            </div>

            <div className='flex-1 min-w-0'>
              <div className='font-medium text-[#111111] text-sm truncate'>{doc.name}</div>
              <div className='text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2'>
                <span>{TYPE_LABELS[doc.type] ?? doc.type}</span>
                <span aria-hidden>·</span>
                <span>{fmtDate(doc.createdAt)}</span>
                <span aria-hidden>·</span>
                <span>{fmtSize(doc.size)}</span>
                {doc.signedAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span className='text-green-700'>подписан</span>
                  </>
                )}
              </div>
              <div className='text-xs text-gray-400 mt-0.5 truncate'>
                Сделка: {doc.orderNumber ?? doc.orderTitle}
              </div>
            </div>

            <button
              type='button'
              onClick={() => download(doc.id, doc.name)}
              disabled={downloading === doc.id}
              className='px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 flex-shrink-0'
            >
              {downloading === doc.id ? 'Готовим…' : 'Скачать'}
            </button>
          </li>
        ))}
      </ul>

      {rows.length === 200 && (
        <div className='text-xs text-gray-500 text-center'>
          Показаны первые 200 документов. Чтобы увидеть остальные, уточните фильтр.
        </div>
      )}
    </div>
  );
}

function iconForType(type: string): string {
  switch (type) {
    case 'contract':
    case 'extra_agreement':
      return '📜';
    case 'invoice':
    case 'act':
    case 'waybill':
      return '🧾';
    case 'certificate':
      return '🎖';
    case 'report':
      return '📊';
    case 'commission_statement':
      return '💼';
    default:
      return '📄';
  }
}

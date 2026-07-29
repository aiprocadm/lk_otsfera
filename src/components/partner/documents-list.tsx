'use client';
import React, { useState } from 'react';
import Link from 'next/link';
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

export function DocumentsList({
  rows,
  downloadEndpointBase = '/api/documents',
  downloadEndpointQuery = '',
  newDocIds = [],
  groupByOrder = false,
  cardHrefBase
}: {
  rows: OrgDocumentRow[];
  downloadEndpointBase?: string;
  downloadEndpointQuery?: string;
  /**
   * §11 ТЗ v0.5 (этап 1 PR-4): база ссылки на карточку документа в текущем
   * кабинете, например `/manager/documents`. Не передан — имя остаётся
   * текстом (списки без карточки, например портфель партнёра).
   */
  cardHrefBase?: string;
  /** Этап 3 PR-2 (ФТ-6.6): id непросмотренных документов — бейдж «новый». */
  newDocIds?: string[];
  /** Этап 3 PR-2 (ФТ-6.6): секции «Заказ №…» / «Без заказа» вместо плоского списка. */
  groupByOrder?: boolean;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Локально гасим бейдж сразу после скачивания (сервер ставит отметку в download-роуте).
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());

  const isNew = (id: string) => newDocIds.includes(id) && !seen.has(id);

  async function download(docId: string, name: string) {
    setError(null);
    setDownloading(docId);
    try {
      const res = await fetch(
        `${downloadEndpointBase}/${docId}/download${downloadEndpointQuery}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        // 410 Gone — карантин ClamAV (CLAUDE.md §10): повтор не поможет
        setError(
          res.status === 410
            ? 'Файл в карантине: не прошёл антивирусную проверку.'
            : 'Не удалось получить ссылку для скачивания'
        );
        return;
      }
      const body = (await res.json()) as { downloadUrl?: string };
      if (!body.downloadUrl) {
        setError('Ссылка не вернулась — попробуйте ещё раз');
        return;
      }
      setSeen((prev) => new Set(prev).add(docId));
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

  const renderRow = (doc: OrgDocumentRow) => (
    <li key={doc.id} className='px-4 py-3 flex items-center gap-3 hover:bg-gray-50'>
      <div className='w-10 h-10 bg-[#FFF7ED] rounded-lg flex items-center justify-center flex-shrink-0'>
        <span className='text-lg'>{iconForType(doc.type)}</span>
      </div>

      <div className='flex-1 min-w-0'>
        <div className='font-medium text-[#111111] text-sm truncate'>
          {cardHrefBase ? (
            <Link href={`${cardHrefBase}/${doc.id}`} className='hover:underline'>
              {doc.name}
            </Link>
          ) : (
            doc.name
          )}
          {isNew(doc.id) && (
            <span className='ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-[#FFF7ED] text-[#9A3412]'>
              новый
            </span>
          )}
        </div>
        <div className='text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2'>
          <span>{TYPE_LABELS[doc.type] ?? doc.type}</span>
          <span aria-hidden>·</span>
          <span>{fmtDate(doc.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>{fmtSize(doc.size)}</span>
          <span aria-hidden>·</span>
          <span className={doc.direction === 'incoming' ? 'text-blue-700' : 'text-gray-500'}>
            {doc.direction === 'incoming' ? 'Входящий' : 'Исходящий'}
          </span>
          {doc.signedAt && (
            <>
              <span aria-hidden>·</span>
              <span className='text-green-700'>подписан</span>
            </>
          )}
        </div>
        {!groupByOrder && (
          <div className='text-xs text-gray-400 mt-0.5 truncate'>
            {doc.orderId ? `Заказ: ${doc.orderNumber ?? doc.orderTitle}` : 'Общий документ'}
          </div>
        )}
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
  );

  return (
    <div className='space-y-2'>
      {error && (
        <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
          {error}
        </div>
      )}

      {groupByOrder ? (
        groupRows(rows).map((group) => (
          <section key={group.key} className='space-y-1'>
            <h3 className='text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 pt-2'>
              {group.title}
            </h3>
            <ul className='bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden'>
              {group.rows.map(renderRow)}
            </ul>
          </section>
        ))
      ) : (
        <ul className='bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden'>
          {rows.map(renderRow)}
        </ul>
      )}

      {rows.length === 200 && (
        <div className='text-xs text-gray-500 text-center'>
          Показаны первые 200 документов. Чтобы увидеть остальные, уточните фильтр.
        </div>
      )}
    </div>
  );
}

/** Секции по заказу в порядке первого появления (rows приходят createdAt desc); «Без заказа» — как есть. */
function groupRows(rows: OrgDocumentRow[]): Array<{ key: string; title: string; rows: OrgDocumentRow[] }> {
  const groups = new Map<string, { key: string; title: string; rows: OrgDocumentRow[] }>();
  for (const doc of rows) {
    const key = doc.orderId ?? '__none__';
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: doc.orderId ? `Заказ ${doc.orderNumber ? `№ ${doc.orderNumber}` : (doc.orderTitle ?? doc.orderId)}` : 'Без заказа',
        rows: []
      };
      groups.set(key, group);
    }
    group.rows.push(doc);
  }
  return Array.from(groups.values());
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

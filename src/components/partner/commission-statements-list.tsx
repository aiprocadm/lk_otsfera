'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { StatementListItem } from '@/lib/services/partner/finance';
import type { CommissionStatementItem } from '@prisma/client';

type Props = {
  statements: StatementListItem[];
  canManage: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  paid: 'Выплачен',
  superseded: 'Заменён'
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  superseded: 'bg-gray-100 text-gray-400'
};

function fmtMoney(val: unknown): string {
  const n = Number(val);
  return isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}

function fmtPeriod(from: Date, to: Date): string {
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const f = new Date(from);
  const t = new Date(to);
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return `${months[f.getMonth()]} ${f.getFullYear()}`;
  }
  return `${f.toLocaleDateString('ru-RU')} — ${t.toLocaleDateString('ru-RU')}`;
}

function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      className='px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium transition-colors'
    >
      {label}
    </a>
  );
}

function StatementRow({
  stmt,
  canManage
}: {
  stmt: StatementListItem;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CommissionStatementItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && items === null) {
      setLoadingItems(true);
      try {
        const res = await fetch(`/api/partner/finance/statements/${stmt.id}`);
        if (res.ok) {
          const data = await res.json() as { statement?: { items?: CommissionStatementItem[] } };
          setItems(data.statement?.items ?? []);
        }
      } finally {
        setLoadingItems(false);
      }
    }
  }

  async function handleApprove() {
    startTransition(async () => {
      const res = await fetch(`/api/partner/finance/statements/${stmt.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      });
      if (res.ok) router.refresh();
      else alert('Ошибка утверждения: ' + res.status);
    });
  }

  return (
    <div className='border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm'>
      {/* Header row */}
      <button
        onClick={toggleOpen}
        className='w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors'
      >
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-3'>
            <span className='font-medium text-[#111111]'>
              {fmtPeriod(stmt.periodFrom, stmt.periodTo)}
            </span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[stmt.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {STATUS_LABELS[stmt.status] ?? stmt.status}
            </span>
          </div>
          <div className='text-sm text-gray-500 mt-0.5'>
            {stmt.itemCount} {stmt.itemCount === 1 ? 'заказ' : 'заказов'} · Комиссия: {fmtMoney(stmt.totalCommissionAmount)}
          </div>
        </div>

        {/* Action buttons */}
        <div className='flex items-center gap-2 shrink-0' onClick={(e) => e.stopPropagation()}>
          {stmt.pdfPath ? (
            <DownloadButton
              href={`/api/partner/finance/statements/${stmt.id}/pdf`}
              label='PDF'
            />
          ) : (
            <span className='px-3 py-1.5 text-xs rounded-lg border border-gray-100 text-gray-300'>PDF…</span>
          )}
          {stmt.xlsxPath ? (
            <DownloadButton
              href={`/api/partner/finance/statements/${stmt.id}/xlsx`}
              label='XLSX'
            />
          ) : (
            <span className='px-3 py-1.5 text-xs rounded-lg border border-gray-100 text-gray-300'>XLSX…</span>
          )}
          {canManage && stmt.status === 'draft' && (
            <button
              onClick={handleApprove}
              disabled={isPending}
              className='px-3 py-1.5 text-xs rounded-lg bg-[#F97316] text-white font-medium hover:bg-[#EA580C] disabled:opacity-50 transition-colors'
            >
              {isPending ? '…' : 'Утвердить'}
            </button>
          )}
        </div>

        <svg
          className={`h-4 w-4 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          fill='none' viewBox='0 0 24 24' stroke='currentColor'
        >
          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
        </svg>
      </button>

      {/* Expandable items */}
      {open && (
        <div className='border-t border-gray-100 overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='bg-gray-50 text-left'>
                <th className='px-4 py-2 font-medium text-gray-500'>Заказ</th>
                <th className='px-4 py-2 font-medium text-gray-500'>Организация</th>
                <th className='px-4 py-2 font-medium text-gray-500 text-right'>База, ₽</th>
                <th className='px-4 py-2 font-medium text-gray-500 text-right'>Ставка</th>
                <th className='px-4 py-2 font-medium text-gray-500 text-right'>Комиссия, ₽</th>
              </tr>
            </thead>
            <tbody>
              {loadingItems && (
                <tr>
                  <td colSpan={5} className='px-4 py-4 text-center text-gray-400 text-xs'>
                    Загружаю…
                  </td>
                </tr>
              )}
              {!loadingItems && items?.map((item) => (
                <tr key={item.id} className='border-t border-gray-50'>
                  <td className='px-4 py-2 text-gray-700'>{item.orderNumber ?? '—'}</td>
                  <td className='px-4 py-2 text-gray-700'>{item.organizationName}</td>
                  <td className='px-4 py-2 text-right text-gray-700'>{fmtMoney(item.baseAmount)}</td>
                  <td className='px-4 py-2 text-right text-gray-500'>{(Number(item.rate) * 100).toFixed(2)}%</td>
                  <td className='px-4 py-2 text-right font-medium text-gray-700'>{fmtMoney(item.commissionAmount)}</td>
                </tr>
              ))}
              {!loadingItems && items !== null && items.length === 0 && (
                <tr>
                  <td colSpan={5} className='px-4 py-4 text-center text-gray-400 text-xs'>
                    Нет данных
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CommissionStatementsList({ statements, canManage }: Props) {
  if (statements.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='text-4xl mb-3'>📊</div>
        <p className='text-gray-500 text-sm'>Отчётов ещё нет.</p>
        {canManage && (
          <p className='text-gray-400 text-xs mt-1'>
            Нажмите «Сформировать за период», чтобы создать первый отчёт.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>Отчёты</h2>
      {statements.map((stmt) => (
        <StatementRow key={stmt.id} stmt={stmt} canManage={canManage} />
      ))}
    </div>
  );
}

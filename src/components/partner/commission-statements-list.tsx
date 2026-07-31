'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CommissionStatementItem } from '@prisma/client';
import type { StatementListItem } from '@/lib/services/partner/finance';
import { THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtMoney, fmtDate, pluralizeRu } from '@/lib/format';
import { toast } from '@/lib/ui/toast';
import { useClientResource } from '@/hooks/useClientResource';

type Props = {
  statements: StatementListItem[];
  canManage: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  paid: 'Выплачен',
  superseded: 'Заменён',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  superseded: 'bg-gray-100 text-gray-400',
};

function fmtPeriod(from: Date, to: Date): string {
  const months = [
    'янв',
    'фев',
    'мар',
    'апр',
    'май',
    'июн',
    'июл',
    'авг',
    'сен',
    'окт',
    'ноя',
    'дек',
  ];
  const f = new Date(from);
  const t = new Date(to);
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return `${months[f.getMonth()]} ${f.getFullYear()}`;
  }
  return `${fmtDate(f)} — ${fmtDate(t)}`;
}

function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium transition-colors"
    >
      {label}
    </a>
  );
}

function StatementRow({ stmt, canManage }: { stmt: StatementListItem; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: items, loading: loadingItems } = useClientResource<CommissionStatementItem[]>(
    `/api/partner/finance/statements/${stmt.id}`,
    {
      enabled: open,
      select: (d) =>
        (d as { statement?: { items?: CommissionStatementItem[] } }).statement?.items ?? [],
    }
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggleOpen() {
    setOpen((v) => !v);
  }

  async function handleApprove() {
    startTransition(async () => {
      const res = await fetch(`/api/partner/finance/statements/${stmt.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      if (res.ok) {
        toast.success('Отчёт утверждён');
        router.refresh();
      } else {
        toast.error('Не удалось утвердить отчёт');
      }
    });
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Header row — role=button (not <button>) so the nested action <button>/<a>
          controls below stay valid HTML. A <button> inside a <button>, or an <a>
          inside a <button>, is invalid nesting and triggers a React hydration
          mismatch (server DOM ≠ browser-corrected DOM) → client re-render / full
          reload. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleOpen();
          }
        }}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-medium text-[#111111]">
              {fmtPeriod(stmt.periodFrom, stmt.periodTo)}
            </span>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[stmt.status] ?? 'bg-gray-100 text-gray-500'}`}
            >
              {STATUS_LABELS[stmt.status] ?? stmt.status}
            </span>
          </div>
          <div className="text-sm text-gray-500 mt-0.5">
            {stmt.itemCount} {pluralizeRu(stmt.itemCount, 'заказ', 'заказа', 'заказов')} · Комиссия:{' '}
            {fmtMoney(String(stmt.totalCommissionAmount))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {stmt.pdfPath ? (
            <DownloadButton href={`/api/partner/finance/statements/${stmt.id}/pdf`} label="PDF" />
          ) : (
            <span className="px-3 py-1.5 text-xs rounded-lg border border-gray-100 text-gray-300">
              PDF…
            </span>
          )}
          {stmt.xlsxPath ? (
            <DownloadButton href={`/api/partner/finance/statements/${stmt.id}/xlsx`} label="XLSX" />
          ) : (
            <span className="px-3 py-1.5 text-xs rounded-lg border border-gray-100 text-gray-300">
              XLSX…
            </span>
          )}
          {canManage && stmt.status === 'draft' && (
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="px-3 py-1.5 text-xs rounded-lg bg-[#F97316] text-white font-medium hover:bg-[#EA580C] disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : 'Утвердить'}
            </button>
          )}
        </div>

        <svg
          className={`h-4 w-4 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expandable items */}
      {open && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <THead>
              <Th className="py-2 text-gray-500">Заказ</Th>
              <Th className="py-2 text-gray-500">Организация</Th>
              <Th className="py-2 text-gray-500 text-right">База, ₽</Th>
              <Th className="py-2 text-gray-500 text-right">Ставка</Th>
              <Th className="py-2 text-gray-500 text-right">Комиссия, ₽</Th>
            </THead>
            <tbody>
              {loadingItems && (
                <Tr hover={false}>
                  <Td colSpan={5} className="py-4 text-center text-gray-400 text-xs">
                    Загружаю…
                  </Td>
                </Tr>
              )}
              {!loadingItems &&
                items?.map((item) => (
                  <Tr key={item.id} hover={false}>
                    <Td className="py-2 text-gray-700">{item.orderNumber ?? '—'}</Td>
                    <Td className="py-2 text-gray-700">{item.organizationName}</Td>
                    <Td className="py-2 text-right text-gray-700">
                      {fmtMoney(String(item.baseAmount))}
                    </Td>
                    <Td className="py-2 text-right text-gray-500">
                      {(Number(item.rate) * 100).toFixed(2)}%
                    </Td>
                    <Td className="py-2 text-right font-medium text-gray-700">
                      {fmtMoney(String(item.commissionAmount))}
                    </Td>
                  </Tr>
                ))}
              {!loadingItems && items !== null && items.length === 0 && (
                <Tr hover={false}>
                  <Td colSpan={5} className="py-4 text-center text-gray-400 text-xs">
                    Нет данных
                  </Td>
                </Tr>
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
      <EmptyState icon="📊" message="Отчётов ещё нет.">
        {canManage && (
          <p className="text-gray-400 text-xs mt-1">
            Нажмите «Сформировать за период», чтобы создать первый отчёт.
          </p>
        )}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Отчёты</h2>
      {statements.map((stmt) => (
        <StatementRow key={stmt.id} stmt={stmt} canManage={canManage} />
      ))}
    </div>
  );
}

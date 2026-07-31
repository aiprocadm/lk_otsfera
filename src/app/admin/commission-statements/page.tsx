import React from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  listAdminStatements,
  listPartnersForFilter,
  type ListAdminStatementsOptions,
} from '@/lib/services/admin/commissionStatements';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  paid: 'Выплачен',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
};

function fmtMoney(val: unknown): string {
  const n = Number(val);
  return Number.isFinite(n)
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
    : '—';
}

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

function parseStatus(raw: string | undefined): ListAdminStatementsOptions['status'] {
  if (raw === 'draft' || raw === 'approved' || raw === 'paid') return raw;
  return undefined;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

type SearchParams = Promise<{ status?: string; partnerId?: string; from?: string; to?: string }>;

export default async function AdminCommissionStatementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const partnerId = sp.partnerId || undefined;
  const from = parseDate(sp.from);
  const to = parseDate(sp.to);

  const [rows, partners] = await Promise.all([
    listAdminStatements(prisma, { status, partnerId, from, to, take: 100 }),
    listPartnersForFilter(prisma),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Комиссионные отчёты</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Все партнёры. По умолчанию показаны утверждённые и выплаченные. Кликните по отчёту, чтобы
          открыть карточку.
        </p>
      </div>

      <form
        method="get"
        className="bg-white border border-gray-200 rounded-xl p-4 grid gap-3 grid-cols-1 sm:grid-cols-4"
      >
        <label className="text-xs text-gray-600 flex flex-col gap-1">
          Статус
          <select
            name="status"
            defaultValue={sp.status ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">Утв. + выпл.</option>
            <option value="draft">Черновики</option>
            <option value="approved">Утверждённые</option>
            <option value="paid">Выплаченные</option>
          </select>
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">
          Партнёр
          <select
            name="partnerId"
            defaultValue={sp.partnerId ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">Все партнёры</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">
          Период с
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">
          Период по
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </label>
        <div className="sm:col-span-4 flex justify-end">
          <button
            type="submit"
            className="px-4 py-2 text-sm rounded-lg bg-[#111111] text-white font-medium hover:bg-[#F97316] transition-colors"
          >
            Применить
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState message="Отчёты по фильтру не найдены." className="p-8" />
      ) : (
        <TableShell overflow="x-auto">
          <THead>
            <Th>Партнёр</Th>
            <Th>Период</Th>
            <Th>Статус</Th>
            <Th className="text-right">Заказов</Th>
            <Th className="text-right">Сумма</Th>
            <Th className="text-right">Действие</Th>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="text-[#111111] font-medium">{r.partner.name}</Td>
                <Td className="text-gray-700">{fmtPeriod(r.periodFrom, r.periodTo)}</Td>
                <Td>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-500'}`}
                  >
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </Td>
                <Td className="text-right tabular-nums text-gray-700">{r.itemCount}</Td>
                <Td className="text-right tabular-nums font-medium text-[#111111]">
                  {fmtMoney(r.totalCommissionAmount)}
                </Td>
                <Td className="text-right">
                  <Link
                    href={`/admin/commission-statements/${r.id}`}
                    className="text-[#F97316] hover:underline text-xs font-medium"
                  >
                    Открыть →
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}

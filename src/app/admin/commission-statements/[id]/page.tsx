import React from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { getAdminStatement, getStatementAuditLog } from '@/lib/services/admin/commissionStatements';
import { MarkPaidForm } from '@/components/admin/mark-paid-form';
import { fmtMoney, fmtDate, fmtDateTime } from '@/lib/format';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

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
  superseded: 'bg-gray-100 text-gray-500',
};

const ACTION_LABELS: Record<string, string> = {
  commission_statement_calculated: 'Рассчитан',
  commission_statement_approved: 'Утверждён',
  commission_statement_paid: 'Выплачен',
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

export default async function AdminCommissionStatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const [statement, audit] = await Promise.all([
    getAdminStatement(prisma, id),
    getStatementAuditLog(prisma, id),
  ]);
  if (!statement) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/commission-statements', [
            {
              label: `${statement.partner.name} · ${fmtPeriod(statement.periodFrom, statement.periodTo)}`,
            },
          ])}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#111111]">
              {statement.partner.name} · {fmtPeriod(statement.periodFrom, statement.periodTo)}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Statement #{statement.id}</p>
          </div>
          <span
            className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
              STATUS_COLORS[statement.status] ?? 'bg-gray-100 text-gray-500'
            }`}
          >
            {STATUS_LABELS[statement.status] ?? statement.status}
          </span>
        </div>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">Заказов</div>
            <div className="font-semibold text-[#111111] tabular-nums">
              {statement.items.length}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">База, всего</div>
            <div className="font-semibold text-[#111111] tabular-nums">
              {fmtMoney(String(statement.totalBaseAmount))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Комиссия, всего</div>
            <div className="font-semibold text-[#F97316] tabular-nums">
              {fmtMoney(String(statement.totalCommissionAmount))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Выплачено</div>
            <div className="font-semibold text-[#111111] tabular-nums">
              {statement.paidAt ? fmtDateTime(statement.paidAt) : '—'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          {statement.pdfPath && (
            <a
              href={`/api/partner/finance/statements/${statement.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium"
            >
              Скачать PDF
            </a>
          )}
          {statement.xlsxPath && (
            <a
              href={`/api/partner/finance/statements/${statement.id}/xlsx`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium"
            >
              Скачать XLSX
            </a>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
          Действие
        </h2>
        <MarkPaidForm statementId={statement.id} status={statement.status} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <h2 className="px-6 pt-6 text-sm font-medium text-gray-500 uppercase tracking-wider">
          Позиции
        </h2>

        {/* У-18: пять колонок — на телефоне карточки. */}
        <CardList className="p-4">
          {statement.items.length === 0 && (
            <li className="text-sm text-gray-400 text-center py-4">Нет позиций.</li>
          )}
          {statement.items.map((item) => (
            <Card key={item.id} title={item.orderNumber ?? '—'}>
              <CardRow label="Организация">{item.organizationName}</CardRow>
              <CardRow label="База">{fmtMoney(String(item.baseAmount))}</CardRow>
              <CardRow label="Ставка">{(Number(item.rate) * 100).toFixed(2)}%</CardRow>
              <CardRow label="Комиссия">{fmtMoney(String(item.commissionAmount))}</CardRow>
            </Card>
          ))}
        </CardList>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm mt-3">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th scope="col" className="text-left px-4 py-3 font-medium">
                  Заказ
                </th>
                <th scope="col" className="text-left px-4 py-3 font-medium">
                  Организация
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  База
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  Ставка
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  Комиссия
                </th>
              </tr>
            </thead>
            <tbody>
              {statement.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">
                    Нет позиций.
                  </td>
                </tr>
              )}
              {statement.items.map((item) => (
                <tr key={item.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-700">{item.orderNumber ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{item.organizationName}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                    {fmtMoney(String(item.baseAmount))}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                    {(Number(item.rate) * 100).toFixed(2)}%
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-[#111111]">
                    {fmtMoney(String(item.commissionAmount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
          Audit log
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-gray-400">Записей пока нет.</p>
        ) : (
          <ol className="space-y-2">
            {audit.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0"
              >
                <div>
                  <div className="font-medium text-[#111111]">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </div>
                  <div className="text-xs text-gray-500">{entry.userName ?? entry.userId}</div>
                </div>
                <div className="text-xs text-gray-500 tabular-nums">
                  {fmtDateTime(entry.createdAt)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

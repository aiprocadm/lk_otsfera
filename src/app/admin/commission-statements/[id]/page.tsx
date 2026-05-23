import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import {
  getAdminStatement,
  getStatementAuditLog,
} from '@/lib/services/admin/commissionStatements';
import { MarkPaidForm } from '@/components/admin/mark-paid-form';

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

function fmtMoney(val: unknown): string {
  const n = Number(val);
  return Number.isFinite(n)
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
    : '—';
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

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function AdminCommissionStatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/login');

  const { id } = await params;
  const [statement, audit] = await Promise.all([
    getAdminStatement(prisma, id),
    getStatementAuditLog(prisma, id),
  ]);
  if (!statement) notFound();

  return (
    <div className='space-y-5'>
      <div className='flex items-center gap-3 text-sm text-gray-500'>
        <Link href='/admin/commission-statements' className='hover:text-[#F97316]'>
          ← Все отчёты
        </Link>
      </div>

      <div className='bg-white border border-gray-200 rounded-xl p-6 space-y-4'>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold text-[#111111]'>
              {statement.partner.name} · {fmtPeriod(statement.periodFrom, statement.periodTo)}
            </h1>
            <p className='text-sm text-gray-500 mt-0.5'>Statement #{statement.id}</p>
          </div>
          <span
            className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
              STATUS_COLORS[statement.status] ?? 'bg-gray-100 text-gray-500'
            }`}
          >
            {STATUS_LABELS[statement.status] ?? statement.status}
          </span>
        </div>

        <div className='grid gap-3 grid-cols-2 md:grid-cols-4 text-sm'>
          <div>
            <div className='text-xs text-gray-500'>Заказов</div>
            <div className='font-semibold text-[#111111] tabular-nums'>{statement.items.length}</div>
          </div>
          <div>
            <div className='text-xs text-gray-500'>База, всего</div>
            <div className='font-semibold text-[#111111] tabular-nums'>
              {fmtMoney(statement.totalBaseAmount)}
            </div>
          </div>
          <div>
            <div className='text-xs text-gray-500'>Комиссия, всего</div>
            <div className='font-semibold text-[#F97316] tabular-nums'>
              {fmtMoney(statement.totalCommissionAmount)}
            </div>
          </div>
          <div>
            <div className='text-xs text-gray-500'>Выплачено</div>
            <div className='font-semibold text-[#111111] tabular-nums'>{fmtDate(statement.paidAt)}</div>
          </div>
        </div>

        <div className='flex items-center gap-2 pt-2 border-t border-gray-100'>
          {statement.pdfPath && (
            <a
              href={`/api/partner/finance/statements/${statement.id}/pdf`}
              target='_blank'
              rel='noreferrer'
              className='px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium'
            >
              Скачать PDF
            </a>
          )}
          {statement.xlsxPath && (
            <a
              href={`/api/partner/finance/statements/${statement.id}/xlsx`}
              target='_blank'
              rel='noreferrer'
              className='px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium'
            >
              Скачать XLSX
            </a>
          )}
        </div>
      </div>

      <div className='bg-white border border-gray-200 rounded-xl p-6'>
        <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider mb-3'>Действие</h2>
        <MarkPaidForm statementId={statement.id} status={statement.status} />
      </div>

      <div className='bg-white border border-gray-200 rounded-xl overflow-x-auto'>
        <h2 className='px-6 pt-6 text-sm font-medium text-gray-500 uppercase tracking-wider'>Позиции</h2>
        <table className='w-full text-sm mt-3'>
          <thead className='bg-gray-50 text-gray-600'>
            <tr>
              <th className='text-left px-4 py-3 font-medium'>Заказ</th>
              <th className='text-left px-4 py-3 font-medium'>Организация</th>
              <th className='text-right px-4 py-3 font-medium'>База</th>
              <th className='text-right px-4 py-3 font-medium'>Ставка</th>
              <th className='text-right px-4 py-3 font-medium'>Комиссия</th>
            </tr>
          </thead>
          <tbody>
            {statement.items.length === 0 && (
              <tr>
                <td colSpan={5} className='px-4 py-6 text-center text-gray-400 text-sm'>
                  Нет позиций.
                </td>
              </tr>
            )}
            {statement.items.map((item) => (
              <tr key={item.id} className='border-t border-gray-100'>
                <td className='px-4 py-2 text-gray-700'>{item.orderNumber ?? '—'}</td>
                <td className='px-4 py-2 text-gray-700'>{item.organizationName}</td>
                <td className='px-4 py-2 text-right tabular-nums text-gray-700'>
                  {fmtMoney(item.baseAmount)}
                </td>
                <td className='px-4 py-2 text-right tabular-nums text-gray-500'>
                  {(Number(item.rate) * 100).toFixed(2)}%
                </td>
                <td className='px-4 py-2 text-right tabular-nums font-medium text-[#111111]'>
                  {fmtMoney(item.commissionAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className='bg-white border border-gray-200 rounded-xl p-6'>
        <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider mb-3'>Audit log</h2>
        {audit.length === 0 ? (
          <p className='text-sm text-gray-400'>Записей пока нет.</p>
        ) : (
          <ol className='space-y-2'>
            {audit.map((entry) => (
              <li
                key={entry.id}
                className='flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0'
              >
                <div>
                  <div className='font-medium text-[#111111]'>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </div>
                  <div className='text-xs text-gray-500'>
                    {entry.userName ?? entry.userId}
                  </div>
                </div>
                <div className='text-xs text-gray-500 tabular-nums'>{fmtDate(entry.createdAt)}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

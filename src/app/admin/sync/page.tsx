import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { getSyncSummary, type SyncSummaryRow } from '@/lib/services/syncSummary';

const ENTITY_RU: Record<SyncSummaryRow['entity'], string> = {
  organization: 'Организации',
  order: 'Заказы',
  payment: 'Платежи',
  document: 'Документы'
};

function ageMs(d: Date | null): number | null {
  return d ? Date.now() - d.getTime() : null;
}

function freshnessClass(d: Date | null): string {
  const age = ageMs(d);
  if (age === null) return 'bg-gray-100 text-gray-500';
  if (age <= 2 * 60 * 60 * 1000) return 'bg-green-50 text-green-700';
  if (age <= 24 * 60 * 60 * 1000) return 'bg-yellow-50 text-yellow-700';
  return 'bg-red-50 text-red-700';
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

export default async function AdminSyncPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/login');

  const rows = await getSyncSummary(prisma);

  return (
    <div className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Состояние синхронизации с 1С</h1>
        <p className='text-sm text-gray-500 mt-0.5'>
          События за последние 24 часа. Свежесть «Последнего успеха» подсвечена: ≤2ч — зелёный, ≤24ч — жёлтый, &gt;24ч — красный.
        </p>
      </div>

      <div className='overflow-x-auto bg-white border border-gray-200 rounded-xl'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50 text-gray-600'>
            <tr>
              <th className='text-left px-4 py-3 font-medium'>Сущность</th>
              <th className='text-right px-4 py-3 font-medium'>Успехов 24ч</th>
              <th className='text-right px-4 py-3 font-medium'>Предупреждений</th>
              <th className='text-right px-4 py-3 font-medium'>Ошибок</th>
              <th className='text-left px-4 py-3 font-medium'>Последний успех</th>
              <th className='text-left px-4 py-3 font-medium'>Последняя ошибка</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity} className='border-t border-gray-100'>
                <td className='px-4 py-3 text-[#111111] font-medium'>{ENTITY_RU[r.entity]}</td>
                <td className='px-4 py-3 text-right tabular-nums'>{r.successCount24h}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${r.warnCount24h > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
                  {r.warnCount24h}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${r.errorCount24h > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                  {r.errorCount24h}
                </td>
                <td className='px-4 py-3'>
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${freshnessClass(r.lastSuccessAt)}`}>
                    {formatDate(r.lastSuccessAt)}
                  </span>
                </td>
                <td className='px-4 py-3 text-gray-700'>
                  {r.lastErrorAt ? (
                    <div>
                      <div className='text-xs text-gray-500'>{formatDate(r.lastErrorAt)}</div>
                      {r.lastErrorMessage && (
                        <div className='text-xs text-red-700 mt-0.5 line-clamp-2'>{r.lastErrorMessage}</div>
                      )}
                    </div>
                  ) : (
                    <span className='text-gray-400'>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

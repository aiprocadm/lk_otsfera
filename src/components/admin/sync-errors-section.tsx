import React from 'react';
import { EmptyState, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { SyncErrorRow } from '@/lib/services/syncSummary';

/**
 * G2: секция «Ошибки синхронизации» на /admin/health — последние 50 error-строк
 * SyncLog. Server-компонент: данные загружает страница через listSyncErrors.
 * payload сюда не попадает by design (может содержать ПДн) — см. подпись.
 */
export function SyncErrorsSection({ errors }: { errors: SyncErrorRow[] }) {
  return (
    <section className='space-y-3'>
      <div>
        <h2 className='text-base font-semibold text-[#111111]'>Ошибки синхронизации (последние 50)</h2>
        <p className='text-sm text-gray-500 mt-0.5'>
          Полные записи и payload — в БД (payload намеренно не выводится: может содержать ПДн).
        </p>
      </div>
      {errors.length === 0 ? (
        <EmptyState message='Ошибок нет' className='p-8' />
      ) : (
        <TableShell overflow='x-auto'>
          <THead>
            <Th>Время</Th>
            <Th>Сущность</Th>
            <Th>Направление</Th>
            <Th>Операция</Th>
            <Th>Внешний ID</Th>
            <Th>Ошибка</Th>
            <Th className='text-right'>Длительность</Th>
          </THead>
          <tbody>
            {errors.map((e) => (
              <Tr key={e.id}>
                <Td className='text-gray-500 text-xs whitespace-nowrap'>{fmtDateTime(e.createdAt)}</Td>
                <Td className='text-gray-700'>{e.entity}</Td>
                <Td className='text-gray-700'>{e.direction}</Td>
                <Td className='text-gray-700'>{e.operation}</Td>
                <Td className='font-mono text-xs text-gray-600'>{e.externalId ?? '—'}</Td>
                <Td className='text-red-700 text-xs max-w-md'>
                  <span className='line-clamp-2 break-all'>{e.errorMessage ?? '—'}</span>
                </Td>
                <Td className='text-right tabular-nums text-gray-600'>
                  {e.durationMs !== null ? `${e.durationMs} мс` : '—'}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </section>
  );
}

import React from 'react';
import { Badge, EmptyState, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { RequeuePendingButton } from '@/components/admin/requeue-pending-button';
import type { PendingRecordRow } from '@/lib/services/admin/pendingRecords';

const ENTITY_RU: Record<string, string> = {
  organization: 'Организация',
  order: 'Заказ',
  payment: 'Платёж',
  document: 'Документ',
};

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * G1: секция «Отложенные записи 1С» на /admin/sync — read-only обзор
 * прикладного dead-letter (OneCPendingRecord). Server-компонент: данные
 * загружает страница через listPendingRecords; интерактив — только
 * RequeuePendingButton у dead-строк.
 */
export function PendingRecordsSection({ records }: { records: PendingRecordRow[] }) {
  return (
    <div>
      <h2 className='text-lg font-semibold text-[#111111]'>Отложенные записи 1С</h2>
      <p className='text-sm text-gray-500 mt-0.5 mb-3'>
        Прикладной dead-letter синхронизации: записи, отложенные из-за отсутствия зависимостей
        (организации или заказа). Pending повторяются автоматически при live-sync; dead можно
        вернуть в очередь вручную.
      </p>
      {records.length === 0 ? (
        <EmptyState message='Отложенных записей нет' className='p-8' />
      ) : (
        <TableShell overflow='x-auto'>
          <THead>
            <Th>Сущность</Th>
            <Th>Внешний ID</Th>
            <Th>Причина</Th>
            <Th>Попытки</Th>
            <Th>Статус</Th>
            <Th>Впервые</Th>
            <Th>Последняя попытка</Th>
            <Th>Действия</Th>
          </THead>
          <tbody>
            {records.map((r) => (
              <Tr key={r.id} hover={false}>
                <Td className='text-gray-700'>{ENTITY_RU[r.entity] ?? r.entity}</Td>
                <Td className='text-gray-700 font-mono text-xs'>{r.externalId}</Td>
                <Td className='text-gray-700'>{r.reason}</Td>
                <Td className='text-gray-700'>{r.attempts}</Td>
                <Td>
                  <Badge tone={r.status === 'dead' ? 'danger' : 'warning'}>{r.status}</Badge>
                </Td>
                <Td className='text-gray-500'>{DATE_FMT.format(r.firstSeenAt)}</Td>
                <Td className='text-gray-500'>{DATE_FMT.format(r.lastTriedAt)}</Td>
                <Td>{r.status === 'dead' ? <RequeuePendingButton id={r.id} /> : null}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}

import React from 'react';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { AuditDetailButton } from './audit-detail-button';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'medium'
});

export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message='Записей аудита не найдено' className='p-8' />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Когда</Th>
        <Th>Actor</Th>
        <Th>Action</Th>
        <Th>Entity</Th>
        <Th>ID</Th>
        <Th className='text-right'>Detail</Th>
      </THead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td className='text-gray-500 text-xs'>
              {dateFormatter.format(row.createdAt)}
            </Td>
            <Td>
              {row.actor ? (
                <>
                  <div>{row.actor.name}</div>
                  <div className='text-xs text-gray-400'>{row.actor.email}</div>
                </>
              ) : (
                <span className='text-gray-400'>—</span>
              )}
            </Td>
            <Td className='font-mono text-xs'>{row.action}</Td>
            <Td className='text-gray-600'>{row.entity}</Td>
            <Td className='font-mono text-xs text-gray-500'>{row.entityId}</Td>
            <Td className='text-right'>
              <AuditDetailButton row={row} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

import React from 'react';
import type { EnrollmentRow } from '@/lib/services/enrollments/list';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { EnrollmentStatusBadge } from './enrollment-status-badge';
import { fmtDate } from '@/lib/format';
import { pluralizeRu } from '@/lib/format';

/** Read-only list of enrollment requests (submitter view): шапка + счётчик слушателей. */
export function EnrollmentList({ rows }: { rows: EnrollmentRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon='🎓'
        message='Заявок на обучение пока нет — подайте первую через форму выше'
      />
    );
  }
  return (
    <TableShell>
      <THead>
        <Th>Слушатели</Th>
        <Th>Направление</Th>
        <Th>Организация</Th>
        <Th>Статус</Th>
        <Th>Подана</Th>
      </THead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td>
              <div className='font-medium text-[#111111]'>
                {r.firstStudentName ?? '—'}
                {r.studentCount > 1 && <span className='text-gray-500'> и ещё {r.studentCount - 1}</span>}
              </div>
              <div className='text-xs text-gray-500'>
                {r.studentCount} {pluralizeRu(r.studentCount, 'слушатель', 'слушателя', 'слушателей')}
              </div>
            </Td>
            <Td className='text-gray-700'>{r.directionName}</Td>
            <Td className='text-gray-600'>{r.organizationName ?? '—'}</Td>
            <Td>
              <EnrollmentStatusBadge status={r.status} />
              {r.status === 'rejected' && r.rejectedReason && (
                <div className='text-xs text-gray-500 mt-0.5'>{r.rejectedReason}</div>
              )}
            </Td>
            <Td className='text-gray-500'>{fmtDate(r.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

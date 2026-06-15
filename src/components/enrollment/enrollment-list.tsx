import type { EnrollmentRow } from '@/lib/services/enrollments/list';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { EnrollmentStatusBadge } from './enrollment-status-badge';
import { fmtDate } from '@/lib/format';

/** Read-only list of enrollment requests (submitter view). */
export function EnrollmentList({ rows }: { rows: EnrollmentRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon='🎓' message='Заявок на обучение пока нет' />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Слушатель</Th>
        <Th>Курс</Th>
        <Th>Организация</Th>
        <Th>Статус</Th>
        <Th>Подана</Th>
      </THead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td>
              <div className='font-medium text-[#111111]'>{r.studentName}</div>
              <div className='text-xs text-gray-500'>{r.studentEmail}</div>
            </Td>
            <Td className='text-gray-700'>{r.courseTitle}</Td>
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

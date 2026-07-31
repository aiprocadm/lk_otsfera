import React from 'react';
import Link from 'next/link';
import type { EnrollmentRow } from '@/lib/services/enrollments/list';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { pluralizeRu } from '@/lib/format';
import { EnrollmentStatusBadge } from './enrollment-status-badge';

/**
 * Read-only list of enrollment requests (submitter view): шапка + счётчик
 * слушателей. `detailHrefBase` (например `/organization/enrollments`) включает
 * ссылку на деталку со статусной лентой — есть у organization/partner (PR-2).
 */
export function EnrollmentList({
  rows,
  detailHrefBase,
}: {
  rows: EnrollmentRow[];
  detailHrefBase?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="🎓"
        message="Заявок на обучение пока нет — подайте первую через форму выше"
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
              <div className="font-medium text-[#111111]">
                {detailHrefBase ? (
                  <Link
                    href={`${detailHrefBase}/${r.id}`}
                    className="hover:text-[#F97316] hover:underline"
                  >
                    {r.firstStudentName ?? '—'}
                  </Link>
                ) : (
                  (r.firstStudentName ?? '—')
                )}
                {r.studentCount > 1 && (
                  <span className="text-gray-500"> и ещё {r.studentCount - 1}</span>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {r.studentCount}{' '}
                {pluralizeRu(r.studentCount, 'слушатель', 'слушателя', 'слушателей')}
                {detailHrefBase && (
                  <>
                    {' · '}
                    <Link
                      href={`${detailHrefBase}/${r.id}`}
                      className="text-[#F97316] hover:underline"
                    >
                      подробнее
                    </Link>
                  </>
                )}
              </div>
            </Td>
            <Td className="text-gray-700">{r.directionName}</Td>
            <Td className="text-gray-600">{r.organizationName ?? '—'}</Td>
            <Td>
              <EnrollmentStatusBadge status={r.status} />
              {r.status === 'rejected' && r.rejectedReason && (
                <div className="text-xs text-gray-500 mt-0.5">{r.rejectedReason}</div>
              )}
            </Td>
            <Td className="text-gray-500">{fmtDate(r.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

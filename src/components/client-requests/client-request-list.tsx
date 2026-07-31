import React from 'react';
import Link from 'next/link';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { ClientRequestStatusBadge } from './client-request-status-badge';

/**
 * Список обращений подателя (этап 5, ФТ-1.3): тема, компания, статус (с
 * причиной отказа), дата. `detailHrefBase` (например `/partner/requests`)
 * включает ссылку на деталку.
 */
export function ClientRequestList({
  rows,
  detailHrefBase,
}: {
  rows: ClientRequestRow[];
  detailHrefBase?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState icon="📨" message="Обращений пока нет — отправьте первое через форму выше" />
    );
  }
  return (
    <TableShell>
      <THead>
        <Th>Тема</Th>
        <Th>Компания</Th>
        <Th>Статус</Th>
        <Th>Подано</Th>
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
                    {r.subject}
                  </Link>
                ) : (
                  r.subject
                )}
              </div>
              {detailHrefBase && (
                <div className="text-xs text-gray-500">
                  <Link
                    href={`${detailHrefBase}/${r.id}`}
                    className="text-[#F97316] hover:underline"
                  >
                    подробнее
                  </Link>
                </div>
              )}
            </Td>
            <Td className="text-gray-700">{r.companyName}</Td>
            <Td>
              <ClientRequestStatusBadge status={r.status} />
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

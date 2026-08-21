import React from 'react';
import Link from 'next/link';
import type { ManagerLeadRow } from '@/lib/services/manager/leads';
import { LeadStatusBadge } from '@/components/partner/lead-status-badge';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { fmtMoney } from '@/lib/format';

type Props = {
  rows: ManagerLeadRow[];
  nextCursor: string | null;
  query: Record<string, string | undefined>;
};

function buildNextHref(query: Record<string, string | undefined>, cursor: string): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.assignedToMe) params.set('assignedToMe', query.assignedToMe);
  params.set('cursor', cursor);
  return `/manager/leads?${params.toString()}`;
}

export function ManagerLeadsTable({ rows, nextCursor, query }: Props) {
  if (rows.length === 0) {
    return <EmptyState icon="📬" message="По выбранным фильтрам заявок нет" />;
  }

  return (
    <div className="space-y-3">
      {/* `У-18`: колонок шесть — на телефоне таблица уступает место карточкам,
          иначе страница шире экрана (441px против 390px). */}
      <CardList>
        {rows.map((l) => (
          <Card
            key={l.id}
            title={
              <Link
                href={`/manager/leads/${l.id}`}
                className="font-medium text-[#111111] hover:text-[#F97316]"
              >
                {l.clientCompanyName}
              </Link>
            }
            actions={<LeadStatusBadge status={l.status} />}
          >
            <CardRow label="ИНН">{l.clientInn}</CardRow>
            <CardRow label="Тема">{l.subject}</CardRow>
            <CardRow label="Партнёр">{l.partnerName}</CardRow>
            <CardRow label="Оценка">
              {l.estimatedAmount ? fmtMoney(l.estimatedAmount) : null}
            </CardRow>
            <CardRow label="Менеджер">{l.assignedManagerName}</CardRow>
          </Card>
        ))}
      </CardList>

      <TableShell className="hidden md:block">
        <THead>
          <Th>Клиент</Th>
          <Th>Тема</Th>
          <Th>Партнёр</Th>
          <Th className="text-right">Оценка</Th>
          <Th>Статус</Th>
          <Th>Менеджер</Th>
        </THead>
        <tbody>
          {rows.map((l) => (
            <Tr key={l.id}>
              <Td>
                <Link
                  href={`/manager/leads/${l.id}`}
                  className="font-medium text-[#111111] hover:text-[#F97316]"
                >
                  {l.clientCompanyName}
                </Link>
                {l.clientInn && <div className="text-xs text-gray-500">ИНН {l.clientInn}</div>}
              </Td>
              <Td className="text-gray-600">{l.subject}</Td>
              <Td className="text-gray-600">{l.partnerName}</Td>
              <Td className="text-right text-gray-700">
                {l.estimatedAmount ? fmtMoney(l.estimatedAmount) : '—'}
              </Td>
              <Td>
                <LeadStatusBadge status={l.status} />
              </Td>
              <Td className="text-gray-600">{l.assignedManagerName ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={buildNextHref(query, nextCursor)}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:border-[#F97316] hover:text-[#F97316]"
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}

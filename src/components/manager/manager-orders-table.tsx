import React from 'react';
import Link from 'next/link';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';
import { Badge } from '@/components/ui';
import { paymentStage } from '@/lib/orders/humanStage';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

function fmtMoney(s: string | number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

type SearchParams = {
  search?: string;
  statusId?: string;
  financialStatus?: string;
  organizationId?: string;
  companyId?: string;
  unassigned?: string;
  cursor?: string;
};

type Props = {
  /**
   * `У-112`: у админа в строке есть ещё и компания-продавец — он смотрит на
   * все компании сразу. У менеджера и руководителя такого поля нет: они всегда
   * внутри одной компании, и колонка была бы столбцом одного значения.
   */
  rows: Array<ManagerOrderRow & { company?: { name: string } | null }>;
  nextCursor: string | null;
  searchParams: SearchParams;
  basePath?: string;
  /** Показывать колонку «Компания» (только админский список). */
  showCompany?: boolean;
};

function buildNextHref(searchParams: SearchParams, cursor: string, basePath: string): string {
  const params = new URLSearchParams();
  if (searchParams.search) params.set('search', searchParams.search);
  if (searchParams.statusId) params.set('statusId', searchParams.statusId);
  if (searchParams.financialStatus) params.set('financialStatus', searchParams.financialStatus);
  if (searchParams.organizationId) params.set('organizationId', searchParams.organizationId);
  if (searchParams.companyId) params.set('companyId', searchParams.companyId);
  if (searchParams.unassigned) params.set('unassigned', searchParams.unassigned);
  params.set('cursor', cursor);
  return `${basePath}/orders?${params.toString()}`;
}

export function ManagerOrdersTable({
  rows,
  nextCursor,
  searchParams,
  basePath = '/manager',
  showCompany = false,
}: Props) {
  if (rows.length === 0) {
    return <EmptyState icon="📋" message="По выбранным фильтрам заказов нет" />;
  }

  return (
    <div className="space-y-3">
      <TableShell className="hidden md:block">
        <THead>
          <Th>№</Th>
          <Th>Название</Th>
          {showCompany && <Th>Компания</Th>}
          <Th>Организация</Th>
          <Th className="text-right">Сумма</Th>
          <Th className="text-right">Оплачено</Th>
          <Th className="text-right">Долг</Th>
          <Th>Исполнение</Th>
          <Th>Финансы</Th>
          <Th>Менеджер</Th>
        </THead>
        <tbody>
          {rows.map((o) => (
            <Tr key={o.id}>
              <Td className="text-gray-500">{o.orderNumber ?? '—'}</Td>
              <Td>
                <Link
                  href={`${basePath}/orders/${o.id}`}
                  className="font-medium text-[#111111] hover:text-[#F97316]"
                >
                  {o.title}
                </Link>
              </Td>
              {showCompany && <Td className="text-gray-600">{o.company?.name ?? '—'}</Td>}
              <Td className="text-gray-600">{o.organization.name}</Td>
              <Td className="text-right text-gray-700">{fmtMoney(o.totalAmount.toString())}</Td>
              <Td className="text-right text-gray-700">{fmtMoney(o.paidAmount.toString())}</Td>
              {/* `У-112`: долг считаем здесь, а не в базе — это разность двух
                  соседних колонок, и отдельное поле разъезжалось бы с ними. */}
              <Td className="text-right text-gray-700">
                {fmtMoney(Number(o.totalAmount) - Number(o.paidAmount))}
              </Td>
              <Td>
                {/* §10 ТЗ v0.5: рабочий статус из справочника. */}
                <Badge tone={o.statusDefinition?.isTerminal ? 'warning' : 'info'}>
                  {o.statusDefinition?.label ?? 'Без статуса'}
                </Badge>
              </Td>
              <Td>
                <DealStatusBadge
                  stage={paymentStage({
                    financialStatus: o.financialStatus,
                    amount: Number(o.totalAmount),
                    paidTotal: Number(o.paidAmount),
                    completed: o.executionStatus === 'completed',
                  })}
                />
              </Td>
              <Td className="text-gray-600">{o.manager?.name ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={buildNextHref(searchParams, nextCursor, basePath)}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:border-[#F97316] hover:text-[#F97316]"
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}

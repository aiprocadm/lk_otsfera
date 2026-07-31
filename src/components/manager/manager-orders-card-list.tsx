import React from 'react';
import Link from 'next/link';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';
import { Badge } from '@/components/ui';
import { paymentStage } from '@/lib/orders/humanStage';

function fmtMoney(s: string | number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

/** Мобильный карточный fallback списка заказов manager/leader (таблица — `hidden md:block`).
 *  Sibling к OrgOrdersCardList (§4). Ведёт на `{basePath}/orders/{id}`. */
export function ManagerOrdersCardList({
  rows,
  basePath = '/manager',
}: {
  rows: ManagerOrderRow[];
  basePath?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="md:hidden space-y-2">
      {rows.map((o) => (
        <Link
          key={o.id}
          href={`${basePath}/orders/${o.id}`}
          className="block bg-white border border-gray-200 rounded-xl p-3 hover:border-[#F97316]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm text-[#111111] truncate">{o.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                №{o.orderNumber ?? '—'} · {o.organization.name}
              </div>
            </div>
            {/* §10 ТЗ v0.5: рабочий статус из справочника (операционный убран
                из интерфейса, решение Q3). */}
            <Badge tone={o.statusDefinition?.isTerminal ? 'warning' : 'info'}>
              {o.statusDefinition?.label ?? 'Без статуса'}
            </Badge>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {fmtMoney(o.totalAmount.toString())} · оплачено {fmtMoney(o.paidAmount.toString())}
            </span>
            <DealStatusBadge
              stage={paymentStage({
                financialStatus: o.financialStatus,
                amount: Number(o.totalAmount),
                paidTotal: Number(o.paidAmount),
                completed: o.executionStatus === 'completed',
              })}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}

import React from 'react';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';
import { orderStage, orderWorkingStage, WORKING_STAGE_LABELS } from '@/lib/orders/humanStage';
import { OrderStageBadge } from '@/components/partner/order-stage-badge';
import { OrderStageStepper } from '@/components/orders/order-stage-stepper';

import { PageHeader } from '@/components/ui/page-header';
/**
 * Manager-side sibling of `org-order-header.tsx`. Same visual shape but the
 * "Менеджер" column shows the org name as primary context (a manager can be
 * looking at multiple orgs) and falls back to manager name when present.
 *
 * The component accepts the raw `ManagerOrderDetail` payload from
 * `getOrder(prisma, session, orderId)` — `stage` is computed locally from the
 * two-dimensional execution/financial statuses via `orderStage`.
 */
export function ManagerOrderHeader({ order }: { order: ManagerOrderDetail }) {
  const stage = orderStage({
    executionStatus: order.executionStatus,
    financialStatus: order.financialStatus,
    amount: Number(order.totalAmount),
    paidTotal: Number(order.paidAmount),
  });
  const workingStage = orderWorkingStage({
    executionStatus: order.executionStatus,
    contractSignedAt: order.contractSignedAt,
    completedAt: order.completedAt,
    closedAt: order.closedAt,
    amount: Number(order.totalAmount),
    paidTotal: Number(order.paidAmount),
  });
  const managerName = order.manager?.name ?? null;
  const orgName = order.organization?.name ?? null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      {/* `У-120`: карточка сущности — подзаголовок из её данных (клиент),
          ответственный справа — тем же пропом `action`. */}
      <div className="flex items-center gap-2 mb-1">
        {order.orderNumber && (
          <span className="text-xs text-gray-500 font-mono">№ {order.orderNumber}</span>
        )}
        <OrderStageBadge stage={stage} />
      </div>
      <PageHeader
        title={order.title}
        subtitle={orgName}
        action={
          managerName ? (
            <div className="text-sm text-gray-500 md:min-w-[180px] md:text-right">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Менеджер</div>
              <div className="font-medium text-[#111111]">{managerName}</div>
            </div>
          ) : null
        }
      />
      <div className="mt-4">
        <OrderStageStepper stage={workingStage} labels={[...WORKING_STAGE_LABELS]} />
      </div>
      {order.productMix.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {order.productMix.map((p) => (
            <span key={p} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

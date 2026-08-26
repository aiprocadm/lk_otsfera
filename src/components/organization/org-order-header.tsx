import React from 'react';
import type { OrgOrderDetail } from '@/lib/services/organization/orders';
import { OrderStageBadge } from '@/components/partner/order-stage-badge';
import { orderWorkingStage, WORKING_STAGE_LABELS } from '@/lib/orders/humanStage';
import { OrderStageStepper } from '@/components/orders/order-stage-stepper';

import { PageHeader } from '@/components/ui/page-header';
export function OrgOrderHeader({ order }: { order: OrgOrderDetail }) {
  const workingStage = orderWorkingStage({
    executionStatus: order.executionStatus,
    contractSignedAt: order.contractSignedAt,
    completedAt: order.completedAt,
    closedAt: order.closedAt,
    amount: order.totalAmount,
    paidTotal: order.paidAmount,
  });
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      {/* `У-120`: зеркало менеджерской карточки заказа — та же шапка. */}
      <div className="flex items-center gap-2 mb-1">
        {order.orderNumber && (
          <span className="text-xs text-gray-500 font-mono">№ {order.orderNumber}</span>
        )}
        <OrderStageBadge stage={order.stage} />
      </div>
      <PageHeader
        title={order.title}
        subtitle={null}
        action={
          order.managerName ? (
            <div className="text-sm text-gray-500 md:min-w-[180px] md:text-right">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Менеджер</div>
              <div className="font-medium text-[#111111]">{order.managerName}</div>
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

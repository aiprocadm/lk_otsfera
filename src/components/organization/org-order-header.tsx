import React from 'react';
import type { OrgOrderDetail } from '@/lib/services/organization/orders';
import { OrderStageBadge } from '@/components/partner/order-stage-badge';
import { OrderStatusStepper } from '@/components/orders/order-status-stepper';
import type { StatusSteps } from '@/lib/orders/statusSteps';

import { PageHeader } from '@/components/ui/page-header';
/** `steps` — шкала этапов из справочника статусов (`У-353`); `null` — шкалы нет. */
export function OrgOrderHeader({
  order,
  steps,
}: {
  order: OrgOrderDetail;
  steps: StatusSteps | null;
}) {
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
      {steps && (
        <div className="mt-4">
          <OrderStatusStepper {...steps} />
        </div>
      )}
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

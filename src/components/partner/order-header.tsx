import React from 'react';
import Link from 'next/link';
import type { PartnerOrderDetail } from '@/lib/services/partner/orderDetail';
import { orderTypeRu } from '@/lib/i18n/labels';
import { OrderStatusStepper } from '@/components/orders/order-status-stepper';
import type { StatusSteps } from '@/lib/orders/statusSteps';
import { PageHeader } from '@/components/ui/page-header';
import { OrderStageBadge } from './order-stage-badge';

/** `steps` — шкала этапов из справочника статусов (`У-353`); `null` — шкалы нет. */
export function PartnerOrderHeader({
  deal,
  steps,
}: {
  deal: PartnerOrderDetail;
  steps: StatusSteps | null;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      {/* `У-120`: зеркало карточки заказа у менеджера и заказчика. */}
      <div className="flex items-center gap-2 mb-1">
        {deal.orderNumber && (
          <span className="text-xs text-gray-500 font-mono">№ {deal.orderNumber}</span>
        )}
        <OrderStageBadge stage={deal.stage} />
      </div>
      <PageHeader
        title={deal.title}
        subtitle={
          deal.organization ? (
            <>
              <Link
                href={`/partner/portfolio/${deal.organization.id}`}
                className="hover:text-[#F97316]"
              >
                {deal.organization.name}
              </Link>
              {deal.organization.inn && (
                <span className="text-gray-400"> · ИНН {deal.organization.inn}</span>
              )}
            </>
          ) : null
        }
        action={
          deal.managerName ? (
            <div className="text-sm text-gray-500 md:min-w-[180px] md:text-right">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Менеджер</div>
              <div className="font-medium text-[#111111]">{deal.managerName}</div>
            </div>
          ) : null
        }
      />
      {steps && (
        <div className="mt-4">
          <OrderStatusStepper {...steps} />
        </div>
      )}
      {deal.productMix.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {deal.productMix.map((p) => (
            <span key={p} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
              {orderTypeRu(p)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

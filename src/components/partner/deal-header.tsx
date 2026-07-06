import React from 'react';
import Link from 'next/link';
import type { DealDetail } from '@/lib/services/partner/dealDetail';
import { DealStatusBadge } from './deal-status-badge';
import { orderTypeRu } from '@/lib/i18n/labels';
import { orderWorkingStage, WORKING_STAGE_LABELS } from '@/lib/orders/humanStage';
import { OrderStageStepper } from '@/components/orders/order-stage-stepper';

export function DealHeader({ deal }: { deal: DealDetail }) {
  const workingStage = orderWorkingStage({
    executionStatus: deal.executionStatus,
    contractSignedAt: deal.contractSignedAt,
    completedAt: deal.completedAt,
    closedAt: deal.closedAt,
    amount: deal.totalAmount,
    paidTotal: deal.paidAmount
  });
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <div className='flex flex-col md:flex-row md:items-start md:justify-between gap-3'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-1'>
            {deal.orderNumber && (
              <span className='text-xs text-gray-500 font-mono'>№ {deal.orderNumber}</span>
            )}
            <DealStatusBadge stage={deal.stage} />
          </div>
          <h1 className='text-2xl font-bold text-[#111111]'>{deal.title}</h1>
          {deal.organization && (
            <div className='text-sm text-gray-500 mt-1'>
              <Link
                href={`/partner/portfolio/${deal.organization.id}`}
                className='hover:text-[#F97316]'
              >
                {deal.organization.name}
              </Link>
              {deal.organization.inn && (
                <span className='text-gray-400'> · ИНН {deal.organization.inn}</span>
              )}
            </div>
          )}
        </div>
        {deal.managerName && (
          <div className='text-right text-sm text-gray-500 md:min-w-[180px]'>
            <div className='text-[10px] uppercase tracking-wider text-gray-400'>Менеджер</div>
            <div className='font-medium text-[#111111]'>{deal.managerName}</div>
          </div>
        )}
      </div>
      <div className='mt-4'>
        <OrderStageStepper stage={workingStage} labels={[...WORKING_STAGE_LABELS]} />
      </div>
      {deal.productMix.length > 0 && (
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {deal.productMix.map((p) => (
            <span
              key={p}
              className='text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded'
            >
              {orderTypeRu(p)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

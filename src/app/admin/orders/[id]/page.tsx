import React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BackLink } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { AssignOrderManagerForm } from '@/components/admin/assign-order-manager-form';
import {
  executionStage,
  paymentStage,
  orderWorkingStage,
  WORKING_STAGE_LABELS,
} from '@/lib/orders/humanStage';
import { OrderStageStepper } from '@/components/orders/order-stage-stepper';
import { getValuesForEntity } from '@/lib/services/customFields';
import { getOrderForAdmin } from '@/lib/services/admin/orders';
import { listManagerCandidates } from '@/lib/services/admin/users';
import { OrderCustomFields } from '@/components/orders/order-custom-fields';

export const dynamic = 'force-dynamic';

function fmtMoney(amount: { toNumber(): number } | number | null | undefined): string {
  if (amount == null) return '—';
  const n = typeof amount === 'number' ? amount : amount.toNumber();
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;

  const [order, candidates, customFieldsResult] = await Promise.all([
    getOrderForAdmin(prisma, id),
    listManagerCandidates(prisma),
    getValuesForEntity(prisma, session, 'order', id),
  ]);
  if (!order) notFound();

  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];

  return (
    <div className="space-y-5">
      <div>
        <BackLink href="/admin/dashboard" label="Главная" />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Заказ № {order.orderNumber}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{order.title}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <OrderStageStepper
          stage={orderWorkingStage({
            executionStatus: order.executionStatus,
            contractSignedAt: order.contractSignedAt,
            completedAt: order.completedAt,
            closedAt: order.closedAt,
            amount: Number(order.totalAmount),
            paidTotal: Number(order.paidAmount),
          })}
          labels={[...WORKING_STAGE_LABELS]}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Организация</div>
          <div className="text-sm text-[#111111] mt-1">
            {order.organization ? (
              <Link
                href={`/admin/organizations/${order.organization.id}`}
                className="text-[#F97316] hover:underline"
              >
                {order.organization.name}
              </Link>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Партнёр</div>
          <div className="text-sm text-[#111111] mt-1">{order.partner?.name ?? '—'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Сумма</div>
          <div className="text-sm text-[#111111] mt-1">{fmtMoney(order.totalAmount)}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Исполнение</div>
          <div className="text-sm font-medium text-[#111111] mt-1">
            {executionStage(order.executionStatus).label}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500">Финансы</div>
          <div className="text-sm font-medium text-[#111111] mt-1">
            {
              paymentStage({
                financialStatus: order.financialStatus,
                amount: Number(order.totalAmount),
                paidTotal: Number(order.paidAmount),
                completed: order.executionStatus === 'completed',
              }).label
            }
          </div>
        </div>
      </div>

      <OrderCustomFields fields={customFields} orderId={order.id} editable={true} />

      <AssignOrderManagerForm
        orderId={order.id}
        currentManagerId={order.managerId}
        candidates={candidates}
      />
    </div>
  );
}

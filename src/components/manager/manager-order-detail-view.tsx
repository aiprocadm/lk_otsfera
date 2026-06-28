import React from 'react';
import { BackLink } from '@/components/ui';
import { ManagerOrderHeader } from '@/components/manager/manager-order-header';
import { ManagerOrderAmounts } from '@/components/manager/manager-order-amounts';
import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
import { ManagerStatusChangeForm } from '@/components/manager/manager-status-change-form';
import { ManagerPaymentsList } from '@/components/manager/manager-payments-list';
import { DocumentsList } from '@/components/partner/documents-list';
import { OrderItemsSection } from '@/components/training/order-items-section';
import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import type { ManagerOrderDetailData } from '@/lib/services/manager/orderDetail';
import type { FieldWithValue } from '@/lib/services/customFields';
import type { TrainingDirection } from '@prisma/client';

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

type Student = { id: string; name: string; email: string };

export function ManagerOrderDetailView({
  data,
  backHref,
  directions,
  students,
  customFields = []
}: {
  data: ManagerOrderDetailData;
  backHref: string;
  directions: TrainingDirection[];
  students: Student[];
  customFields?: FieldWithValue[];
}) {
  const { order, auditEntries, comments, documentRows, items } = data;

  return (
    <div className='space-y-4'>
      <div className='text-sm'>
        <BackLink href={backHref} label='Все заказы' />
      </div>

      <ManagerOrderHeader order={order} />

      <div className='grid gap-4 md:grid-cols-3'>
        <div className='md:col-span-2 space-y-4'>
          <ManagerOrderAmounts order={order} />

          <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
            <h2 className='text-sm font-semibold text-[#111111]'>
              Документы{' '}
              {documentRows.length > 0 && (
                <span className='text-gray-400 font-normal'>({documentRows.length})</span>
              )}
            </h2>
            <DocumentsList
              rows={documentRows}
              downloadEndpointBase='/api/manager/documents'
            />
          </div>

          <ManagerPaymentsList payments={order.payments} />

          <OrderItemsSection
            orderId={order.id}
            canEdit
            items={items}
            directions={directions}
            students={students}
          />

          <OrderCustomFields fields={customFields} orderId={order.id} editable={true} />

          {/*
            Read-only comments fallback. Phase 8.4 (Task 25 introduces the manager
            comment server action; Task 31 wires the shared comments thread) will
            replace this block with an interactive thread that lets a manager
            post replies. Until then we just surface the existing thread so the
            manager has the same context the org user sees.
          */}
          <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
            <h2 className='text-sm font-semibold text-[#111111]'>
              Комментарии{' '}
              {comments.length > 0 && (
                <span className='text-gray-400 font-normal'>({comments.length})</span>
              )}
            </h2>
            {comments.length === 0 ? (
              <p className='text-sm text-gray-500'>Комментариев пока нет.</p>
            ) : (
              <ul className='space-y-3'>
                {comments.map((c) => (
                  <li key={c.id} className='flex gap-3'>
                    <div className='w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-xs font-bold flex-shrink-0'>
                      {(c.author.name ?? c.author.email ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className='flex-1 min-w-0 bg-gray-50 rounded-lg px-3 py-2'>
                      <div className='flex items-baseline justify-between gap-2'>
                        <div className='text-xs font-semibold text-[#111111]'>
                          {c.author.name ?? c.author.email}
                        </div>
                        <div className='text-xs text-gray-400'>{fmtDateTime(c.createdAt)}</div>
                      </div>
                      <p className='text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words'>
                        {c.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className='text-xs text-gray-400 pt-2 border-t border-gray-100'>
              Возможность отвечать появится в следующем релизе.
            </p>
          </div>
        </div>

        <div className='space-y-4'>
          <ManagerOrderTimeline order={order} auditEntries={auditEntries} />
          <ManagerStatusChangeForm
            orderId={order.id}
            currentStatus={
              order.executionStatus as
                | 'pending'
                | 'in_progress'
                | 'completed'
                | 'cancelled'
                | 'on_hold'
            }
          />
        </div>
      </div>
    </div>
  );
}
